"""Use cases приложения. Не знают о FastAPI, SQLite и конкретном LLM-провайдере."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone

from nota.application import prompts
from nota.application.errors import (
    AuthError,
    BadRequestError,
    ConsentRequiredError,
    FeatureDisabledError,
    IdempotencyConflictError,
    ProviderUnavailableError,
    QuotaExceededError,
    RateLimitedError,
    RequestInProgressError,
)
from nota.application.ports import ModelGateway, ProductCatalog, Repository
from nota.domain.barcode import BarcodeProduct
from nota.domain.entries import MAX_BATCH, EntryValidationError, validate_entry
from nota.domain.kbju import EstimateParseError, MealEstimate, parse_estimate

_DATA_URL_RE = re.compile(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$")
_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
MAX_IMAGE_BYTES = 900_000
MAX_DESCRIPTION = 500
MAX_HINT = 200
AI_CONSENT_VERSION = "2026-07-22-ai-v1"
DATA_CONSENT_VERSION = "2026-07-28-backup-v1"
_BARCODE_RE = re.compile(r"^\d{8,14}$")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


@dataclass(frozen=True)
class Limits:
    meal_text_per_day: int = 40
    meal_photo_per_day: int = 10
    # None disables the commercial lifetime trial cap while keeping operational
    # daily/concurrency safeguards in place.
    meal_photo_lifetime: int | None = 4
    global_llm_per_day: int = 200
    registration_per_minute: int = 12
    registration_global_per_minute: int = 120
    llm_concurrent_per_device: int = 1
    llm_concurrent_global: int = 4
    photo_request_processing_ttl: int = 120
    photo_idempotency_cache_ttl: int = 86_400


@dataclass(frozen=True)
class PhotoAnalysisResult:
    estimate: MealEstimate
    trial_remaining: int | None
    trial_limit: int | None
    idempotent_replay: bool = False


class _RegistrationLimiter:
    """Small process-local limiter that never retains a raw network address."""

    def __init__(self, per_source: int, global_limit: int, window_seconds: int = 60):
        self._per_source = max(1, per_source)
        self._global_limit = max(1, global_limit)
        self._window = max(1, window_seconds)
        self._salt = secrets.token_bytes(32)
        self._lock = threading.Lock()
        self._global: deque[float] = deque()
        self._sources: dict[str, deque[float]] = {}

    @staticmethod
    def _prune(items: deque[float], threshold: float) -> None:
        while items and items[0] <= threshold:
            items.popleft()

    def allow(self, source: str) -> bool:
        now = time.monotonic()
        threshold = now - self._window
        source_hash = hashlib.blake2s(
            (source or "unknown").encode("utf-8"), key=self._salt
        ).hexdigest()
        with self._lock:
            self._prune(self._global, threshold)
            bucket = self._sources.setdefault(source_hash, deque())
            self._prune(bucket, threshold)
            if len(self._global) >= self._global_limit or len(bucket) >= self._per_source:
                return False
            self._global.append(now)
            bucket.append(now)
            if len(self._sources) > self._global_limit * 2:
                self._sources = {key: value for key, value in self._sources.items() if value}
            return True


class _ConcurrencyGate:
    """Non-blocking in-process LLM gate; SQLite additionally guards photo claims."""

    def __init__(self, per_device: int, global_limit: int):
        self._per_device = max(1, per_device)
        self._global_limit = max(1, global_limit)
        self._global_active = 0
        self._device_active: dict[int, int] = {}
        self._lock = threading.Lock()

    def acquire(self, device_id: int) -> bool:
        with self._lock:
            device_active = self._device_active.get(device_id, 0)
            if self._global_active >= self._global_limit or device_active >= self._per_device:
                return False
            self._global_active += 1
            self._device_active[device_id] = device_active + 1
            return True

    def release(self, device_id: int) -> None:
        with self._lock:
            self._global_active = max(0, self._global_active - 1)
            active = self._device_active.get(device_id, 0) - 1
            if active > 0:
                self._device_active[device_id] = active
            else:
                self._device_active.pop(device_id, None)


class Services:
    def __init__(
        self,
        repo: Repository,
        gateway: ModelGateway,
        limits: Limits | None = None,
        catalog: ProductCatalog | None = None,
    ):
        self._repo = repo
        self.repo = repo  # публичный доступ для админ-роутеров
        self._gateway = gateway
        self._catalog = catalog
        self._limits = limits or Limits()
        self._registrations = _RegistrationLimiter(
            self._limits.registration_per_minute,
            self._limits.registration_global_per_minute,
        )
        self._llm_gate = _ConcurrencyGate(
            self._limits.llm_concurrent_per_device,
            self._limits.llm_concurrent_global,
        )

    # ── устройство ────────────────────────────────────────────────
    def is_healthy(self) -> bool:
        return self._repo.is_healthy()

    def register_device(
        self, source: str = "", consent_granted: bool = False, consent_version: str = ""
    ) -> str:
        if not consent_granted or consent_version != DATA_CONSENT_VERSION:
            raise ConsentRequiredError()
        if not self._registrations.allow(source):
            raise RateLimitedError()
        token = secrets.token_urlsafe(32)
        self._repo.create_device(_token_hash(token), consent_version)
        return token

    def authenticate(self, token: str | None) -> int:
        if not token:
            raise AuthError()
        device_id = self._repo.device_id_by_token_hash(_token_hash(token))
        if device_id is None:
            raise AuthError()
        return device_id

    # ── журнал ────────────────────────────────────────────────────
    def sync(self, device_id: int, raw_entries: list[dict]) -> dict:
        self._require_data_consent(device_id)
        if len(raw_entries) > MAX_BATCH:
            raise BadRequestError("batch too large")
        entries = []
        rejected: list[str] = []
        for raw in raw_entries:
            try:
                entries.append(
                    validate_entry(
                        kind=str(raw.get("kind", "")),
                        client_id=str(raw.get("clientId", "")),
                        at=str(raw.get("at", "")),
                        updated_at=str(raw.get("updatedAt", "")),
                        payload_json=raw.get("payload", "{}")
                        if isinstance(raw.get("payload"), str)
                        else "{}",
                    )
                )
            except EntryValidationError:
                rejected.append(str(raw.get("clientId", "?"))[:64])
        stored = self._repo.upsert_entries(device_id, entries) if entries else []
        stored_by_key = {(entry.kind, entry.client_id): entry for entry in stored}
        accepted = []
        conflicts = []
        for entry in entries:
            actual = stored_by_key[(entry.kind, entry.client_id)]
            if actual == entry:
                accepted.append({"kind": entry.kind, "clientId": entry.client_id})
            else:
                conflicts.append({
                    "kind": actual.kind,
                    "clientId": actual.client_id,
                    "at": actual.at,
                    "updatedAt": actual.updated_at,
                    "payload": actual.payload_json,
                })
        return {
            "accepted": accepted,
            "rejected": rejected,
            "conflicts": conflicts,
        }

    def snapshot(self, device_id: int) -> list[dict]:
        self._require_data_consent(device_id)
        return self._repo.snapshot(device_id)

    def delete_me(self, device_id: int) -> None:
        self._repo.delete_device_data(device_id)

    def delete_me_by_token(self, token: str | None) -> None:
        """Delete is deliberately idempotent for a bearer token.

        A client can lose the response after the database transaction commits.
        The next DELETE must therefore finish local erasure instead of failing
        authentication because the device row has already been removed.
        """
        if not token:
            raise AuthError()
        device_id = self._repo.device_id_by_token_hash(_token_hash(token))
        if device_id is not None:
            self.delete_me(device_id)

    def set_ai_consent(self, device_id: int, granted: bool, version: str) -> None:
        if version != AI_CONSENT_VERSION:
            raise BadRequestError("unsupported consent version")
        self._repo.set_ai_consent(device_id, version, granted)

    def set_data_consent(self, device_id: int, granted: bool, version: str) -> None:
        if version != DATA_CONSENT_VERSION:
            raise BadRequestError("unsupported consent version")
        self._repo.set_data_consent(device_id, version, granted)

    def _require_data_consent(self, device_id: int) -> None:
        if not self._repo.has_data_consent(device_id, DATA_CONSENT_VERSION):
            raise ConsentRequiredError()

    def _require_ai_consent(self, device_id: int) -> None:
        if not self._repo.has_ai_consent(device_id, AI_CONSENT_VERSION):
            raise ConsentRequiredError()

    # ── КБЖУ ──────────────────────────────────────────────────────
    def _reserve(self, device_id: int, kind: str, per_device: int) -> None:
        ok = self._repo.reserve_usage(
            device_id, _today(), kind, per_device, self._limits.global_llm_per_day
        )
        if not ok:
            raise QuotaExceededError()

    def _refund(self, device_id: int, kind: str) -> None:
        self._repo.refund_usage(device_id, _today(), kind)

    def estimate_meal_text(self, device_id: int, description: str) -> MealEstimate:
        self._require_ai_consent(device_id)
        description = (description or "").strip()
        if not description or len(description) > MAX_DESCRIPTION:
            raise BadRequestError("bad description")
        if not self._gateway.enabled:
            raise FeatureDisabledError()
        if not self._llm_gate.acquire(device_id):
            raise RateLimitedError()
        reserved = False
        try:
            self._reserve(device_id, "meal_text", self._limits.meal_text_per_day)
            reserved = True
            raw = self._gateway.complete_text(
                prompts.KBJU_SYSTEM,
                prompts.KBJU_TEXT_USER.format(description=description),
                max_tokens=400,
            )
            return parse_estimate(raw, fallback_description=description)
        except EstimateParseError as exc:
            if reserved:
                self._refund(device_id, "meal_text")
            raise ProviderUnavailableError(str(exc)) from exc
        except Exception:
            if reserved:
                self._refund(device_id, "meal_text")
            raise
        finally:
            self._llm_gate.release(device_id)

    def analyze_meal_photo(
        self,
        device_id: int,
        image_data_url: str,
        hint: str,
        idempotency_key: str | None = None,
    ) -> PhotoAnalysisResult:
        self._require_ai_consent(device_id)
        hint = (hint or "").strip()[:MAX_HINT]
        match = _DATA_URL_RE.match(image_data_url or "")
        if not match:
            raise BadRequestError("bad image data url")
        b64 = re.sub(r"\s+", "", match.group(2))
        try:
            decoded = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise BadRequestError("bad base64") from exc
        if not decoded or len(decoded) > MAX_IMAGE_BYTES:
            raise BadRequestError("image too large")

        request_hash = hashlib.sha256(
            match.group(1).encode("ascii") + b"\0" + hint.encode("utf-8") + b"\0" + decoded
        ).hexdigest()
        if idempotency_key is not None:
            idempotency_key = idempotency_key.strip()
            if not _IDEMPOTENCY_KEY_RE.fullmatch(idempotency_key):
                raise BadRequestError("bad idempotency key")
            effective_key = idempotency_key
        else:
            # Backward compatibility for old clients also protects a double click
            # with the exact same image and hint.
            effective_key = f"auto:{request_hash}"
        key_hash = hashlib.sha256(effective_key.encode("utf-8")).hexdigest()
        now_epoch = int(time.time())
        claim = self._repo.claim_photo_analysis(
            device_id=device_id,
            key_hash=key_hash,
            request_hash=request_hash,
            now_epoch=now_epoch,
            processing_ttl_seconds=self._limits.photo_request_processing_ttl,
            cache_ttl_seconds=self._limits.photo_idempotency_cache_ttl,
            lifetime_limit=self._limits.meal_photo_lifetime,
            per_device_concurrent=self._limits.llm_concurrent_per_device,
            global_concurrent=self._limits.llm_concurrent_global,
        )
        if claim.status == "replay":
            if not claim.response_json:
                raise ProviderUnavailableError()
            try:
                estimate = parse_estimate(claim.response_json, fallback_description=hint)
            except EstimateParseError as exc:
                raise ProviderUnavailableError(str(exc)) from exc
            return PhotoAnalysisResult(
                estimate=estimate,
                trial_remaining=claim.remaining or 0,
                trial_limit=self._limits.meal_photo_lifetime,
                idempotent_replay=True,
            )
        if claim.status == "conflict":
            raise IdempotencyConflictError()
        if claim.status == "in_progress":
            raise RequestInProgressError()
        if claim.status == "quota":
            raise QuotaExceededError()
        if claim.status == "busy":
            raise RateLimitedError()
        if claim.status != "acquired":
            raise ProviderUnavailableError()

        clean_url = f"data:image/{match.group(1)};base64,{b64}"
        acquired_gate = False
        reserved_usage = False
        try:
            if not self._gateway.enabled:
                raise FeatureDisabledError()
            acquired_gate = self._llm_gate.acquire(device_id)
            if not acquired_gate:
                raise RateLimitedError()
            # Attempt/global budgets protect provider cost. They are deliberately
            # separate from the optional commercial lifetime limit.
            self._reserve(device_id, "meal_photo", self._limits.meal_photo_per_day)
            reserved_usage = True
            raw = self._gateway.complete_vision(
                prompts.KBJU_SYSTEM,
                prompts.KBJU_VISION_USER.format(hint=hint or "нет"),
                clean_url,
                max_tokens=500,
            )
            estimate = parse_estimate(raw, fallback_description=hint or "блюдо с фото")
            response_json = json.dumps(
                {
                    "description": estimate.description,
                    "kcal": estimate.kcal,
                    "protein_g": estimate.protein_g,
                    "fat_g": estimate.fat_g,
                    "carb_g": estimate.carb_g,
                    "confidence": estimate.confidence,
                    "comment": estimate.comment,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
            remaining = self._repo.complete_photo_analysis(
                device_id,
                key_hash,
                request_hash,
                response_json,
                int(time.time()),
                self._limits.meal_photo_lifetime,
            )
            return PhotoAnalysisResult(
                estimate=estimate,
                trial_remaining=remaining,
                trial_limit=self._limits.meal_photo_lifetime,
            )
        except EstimateParseError as exc:
            if reserved_usage:
                self._refund(device_id, "meal_photo")
            self._repo.fail_photo_analysis(
                device_id, key_hash, request_hash, int(time.time())
            )
            raise ProviderUnavailableError(str(exc)) from exc
        except Exception:
            if reserved_usage:
                self._refund(device_id, "meal_photo")
            self._repo.fail_photo_analysis(
                device_id, key_hash, request_hash, int(time.time())
            )
            raise
        finally:
            if acquired_gate:
                self._llm_gate.release(device_id)

    def photo_trial_status(self, device_id: int) -> dict:
        used = self._repo.photo_trial_success_count(device_id)
        limit = self._limits.meal_photo_lifetime
        return {
            "photoLimit": limit,
            "photoUsed": min(used, limit) if limit is not None else used,
            "photoRemaining": max(0, limit - used) if limit is not None else None,
        }

    def lookup_barcode(self, device_id: int, code: str) -> BarcodeProduct | None:
        """Return public food data while keeping upstream requests off the device.

        Authentication prevents the endpoint from becoming an open proxy.  Product
        cache records never contain a device id, photo, token or network address.
        """
        del device_id  # The authenticated boundary is intentional; no user data is read.
        code = (code or "").strip()
        if not _BARCODE_RE.fullmatch(code) or not _valid_gtin_check_digit(code):
            raise BadRequestError("bad barcode")
        now_epoch = int(time.time())
        cached = self._repo.cached_barcode(code, now_epoch)
        if cached.hit:
            return cached.product
        if self._catalog is None:
            raise ProviderUnavailableError()
        try:
            product = self._catalog.find(code)
        except Exception as exc:
            raise ProviderUnavailableError() from exc
        self._repo.cache_barcode(
            product, code, now_epoch,
            30 * 24 * 60 * 60 if product else 6 * 60 * 60,
        )
        return product


def _valid_gtin_check_digit(code: str) -> bool:
    """Validate EAN/GTIN checksum before a network request."""
    total = sum(int(digit) * (3 if index % 2 == 0 else 1) for index, digit in enumerate(code[-2::-1]))
    return (10 - total % 10) % 10 == int(code[-1])
