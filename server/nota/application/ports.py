"""Порты приложения: домен и use cases не знают о SQLite и HTTP-провайдерах."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from nota.domain.barcode import BarcodeProduct
from nota.domain.entries import Entry


@dataclass(frozen=True)
class PhotoAnalysisClaim:
    """Result of atomically claiming an idempotent photo-analysis request."""

    status: str
    response_json: str | None = None
    remaining: int | None = None


@dataclass(frozen=True)
class CachedBarcodeLookup:
    hit: bool
    product: BarcodeProduct | None = None


class Repository(Protocol):
    def is_healthy(self) -> bool: ...

    def create_device(self, token_hash: str, data_consent_version: str) -> int: ...

    def device_id_by_token_hash(self, token_hash: str) -> int | None: ...

    def upsert_entries(self, device_id: int, entries: list[Entry]) -> list[Entry]: ...

    def snapshot(self, device_id: int) -> list[dict]: ...

    def delete_device_data(self, device_id: int) -> None: ...

    def set_ai_consent(self, device_id: int, version: str, granted: bool) -> None: ...

    def has_ai_consent(self, device_id: int, version: str) -> bool: ...

    def set_data_consent(self, device_id: int, version: str, granted: bool) -> None: ...

    def has_data_consent(self, device_id: int, version: str) -> bool: ...

    def reserve_usage(
        self, device_id: int, day: str, kind: str, per_device_limit: int, global_limit: int
    ) -> bool:
        """Атомарно увеличивает счётчик; False — лимит исчерпан."""
        ...

    def refund_usage(self, device_id: int, day: str, kind: str) -> None:
        """Return one reserved quota slot when the provider did not produce a result."""
        ...


    def claim_photo_analysis(
        self,
        device_id: int,
        key_hash: str,
        request_hash: str,
        now_epoch: int,
        processing_ttl_seconds: int,
        cache_ttl_seconds: int,
        lifetime_limit: int | None,
        per_device_concurrent: int,
        global_concurrent: int,
    ) -> PhotoAnalysisClaim:
        """Atomically claim, replay or reject an idempotent photo request."""
        ...

    def complete_photo_analysis(
        self,
        device_id: int,
        key_hash: str,
        request_hash: str,
        response_json: str,
        now_epoch: int,
        lifetime_limit: int | None,
    ) -> int | None:
        """Commit one successful use and return remaining lifetime uses, if capped."""
        ...

    def fail_photo_analysis(
        self, device_id: int, key_hash: str, request_hash: str, now_epoch: int
    ) -> None:
        """Release a claimed trial slot without consuming the entitlement."""
        ...

    def photo_trial_success_count(self, device_id: int) -> int:
        ...

    def cached_barcode(self, code: str, now_epoch: int) -> CachedBarcodeLookup:
        ...

    def cache_barcode(
        self, product: BarcodeProduct | None, code: str, now_epoch: int, ttl_seconds: int
    ) -> None:
        ...


class ProductCatalog(Protocol):
    """External catalogue boundary.  Implementations receive only a barcode."""

    source: str

    def find(self, code: str) -> BarcodeProduct | None:
        ...


class ModelGateway(Protocol):
    """Текстовый и визуальный вызов LLM. Возвращает сырой текст ответа модели."""

    enabled: bool
    provider: str

    def complete_text(self, system: str, user: str, max_tokens: int) -> str: ...

    def complete_vision(
        self, system: str, user: str, image_data_url: str, max_tokens: int
    ) -> str: ...
