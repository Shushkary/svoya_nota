"""Админ-панель: вход, CRUD реферальных ссылок и публичный редирект по коду.

Роутеры монтируются в build_app (api.py). Реферальная таблица живёт в той же SQLite,
что и основные данные приложения (см. sqlite_repository._SCHEMA).
"""

from __future__ import annotations

import secrets
import threading
import time

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from nota.application.admin_auth import (
    admin_username,
    issue_token,
    verify_password,
    verify_token,
)
from nota.application.errors import AppError, AuthError
from nota.presentation.schemas import (
    AdminLoginIn,
    ReferralCreateIn,
    ReferralUpdateIn,
)

# Куда ведёт реферальная ссылка по умолчанию (приложение «Своя нота»).
DEFAULT_TARGET = "https://torion.shop/svoya-nota-app/"

# Простой in-memory rate-limit для логина (защита от перебора).
_login_hits: dict[str, list[float]] = {}
_login_lock = threading.Lock()


def _login_allowed(source: str) -> bool:
    now = time.time()
    with _login_lock:
        hits = _login_hits.get(source, [])
        hits = [t for t in hits if now - t < 60]
        if len(hits) >= 12:
            _login_hits[source] = hits
            return False
        hits.append(now)
        _login_hits[source] = hits
    return True


def _generate_code(repo) -> str:
    for _ in range(8):
        candidate = secrets.token_urlsafe(5)  # ~7 символов, URL-safe
        if repo.get_referral_by_code(candidate) is None:
            return candidate
    return secrets.token_urlsafe(8)


def build_referral_routers(repo):
    admin = APIRouter()
    public = APIRouter()

    def require_admin(request: Request) -> str:
        header = request.headers.get("authorization", "")
        if not header.lower().startswith("bearer "):
            raise AuthError()
        user = verify_token(header[7:].strip())
        if not user:
            raise AuthError()
        return user

    @admin.post("/api/admin/login")
    def admin_login(body: AdminLoginIn, request: Request):
        source = request.client.host if request.client else "unknown"
        if not _login_allowed(source):
            raise AppError("too_many_attempts")
        if not (body.username == admin_username() and verify_password(body.password)):
            raise AuthError()
        return {"token": issue_token(body.username)}

    @admin.get("/api/admin/referrals")
    def list_referrals(_u: str = Depends(require_admin)):
        return {"referrals": repo.list_referrals()}

    @admin.post("/api/admin/referrals")
    def create_referral(body: ReferralCreateIn, _u: str = Depends(require_admin)):
        code = _generate_code(repo)
        target = (body.target_url or "").strip() or DEFAULT_TARGET
        referral_id = repo.create_referral(
            code=code,
            label=(body.label or "").strip(),
            target_url=target,
            discount_percent=body.discount_percent,
            reward_percent=body.reward_percent,
            owner_contact=(body.owner_contact or "").strip(),
            payment_details=(body.payment_details or "").strip(),
        )
        return {"id": referral_id, "code": code}

    @admin.patch("/api/admin/referrals/{referral_id}")
    def update_referral(
        referral_id: int, body: ReferralUpdateIn, _u: str = Depends(require_admin)
    ):
        repo.update_referral(referral_id, body.model_dump(exclude_none=True))
        return {"updated": True}

    @admin.delete("/api/admin/referrals/{referral_id}")
    def delete_referral(referral_id: int, _u: str = Depends(require_admin)):
        repo.delete_referral(referral_id)
        return {"deleted": True}

    @public.get("/api/r/{code}")
    def track_referral(code: str):
        """Публичный переход по реферальной ссылке: счётчик + редирект с ?ref=CODE."""
        row = repo.increment_referral_visit(code)
        if row is None:
            return RedirectResponse(DEFAULT_TARGET, status_code=307)
        target = row.get("target_url") or DEFAULT_TARGET
        sep = "&" if "?" in target else "?"
        return RedirectResponse(f"{target}{sep}ref={code}", status_code=307)

    @public.get("/api/referral-info")
    def referral_info(code: str = ""):
        """Публичная карточка реферала: скидка/вознаграждение (для будущей оплаты Robokassa)."""
        row = repo.get_referral_by_code(code) if code else None
        if not row or not row.get("active"):
            return {"found": False}
        return {
            "found": True,
            "code": code,
            "discountPercent": row["discount_percent"],
            "rewardPercent": row["reward_percent"],
            "owner": row["owner_contact"],
        }

    return admin, public
