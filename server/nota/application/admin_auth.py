"""Аутентификация администратора: HMAC-токен и проверка пароля (без внешних зависимостей).

Пароль хранится в окружении в виде `<salt_hex>:<pbkdf2_hex>` (NOTA_ADMIN_PASSWORD_HASH),
секрет подписи токена — в NOTA_ADMIN_SECRET. Оба задаются в /etc/nota/api.env (root-only).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import base64
import os
import time

_TOKEN_TTL_SECONDS = 60 * 60 * 12  # 12 часов
_INSECURE_DEFAULT_SECRET = "insecure-default-change-me"


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def admin_username() -> str:
    return _env("NOTA_ADMIN_USER", "admin")


def _password_hash() -> str:
    return _env("NOTA_ADMIN_PASSWORD_HASH", "")


def _secret() -> str:
    return _env("NOTA_ADMIN_SECRET", "")


def validate_configuration() -> None:
    """Fail closed when an enabled admin account has an unsafe signing secret."""
    if not _password_hash():
        return
    secret = _secret()
    if secret == _INSECURE_DEFAULT_SECRET or len(secret) < 32:
        raise RuntimeError(
            "NOTA_ADMIN_SECRET must be configured and contain at least 32 characters "
            "when NOTA_ADMIN_PASSWORD_HASH is set"
        )


def verify_password(password: str) -> bool:
    stored = _password_hash()
    if ":" not in stored:
        return False
    try:
        salt_hex, hash_hex = stored.split(":", 1)
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return hmac.compare_digest(dk.hex(), hash_hex)


def issue_token(username: str) -> str:
    validate_configuration()
    payload = {"u": username, "exp": int(time.time()) + _TOKEN_TTL_SECONDS}
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.new(_secret().encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def verify_token(token: str | None) -> str | None:
    if not token:
        return None
    try:
        body, sig = token.split(".", 1)
        expected = hmac.new(_secret().encode(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload.get("u")
    except Exception:
        return None
