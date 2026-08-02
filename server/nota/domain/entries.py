"""Чистая валидация журнальных записей синхронизации.

Журнал устроен антихрупко: payload — JSON-объект с ограниченным размером,
kind — из закрытого списка. Сервер не разбирает содержимое по полям: расчёты
петли делает клиент, сервер хранит резервную копию. Эволюция схемы записи не
требует миграции БД.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime

ALLOWED_KINDS = frozenset({"state", "practice", "meal", "will", "activity", "profile", "ritual"})
MAX_CLIENT_ID = 64
MAX_PAYLOAD_BYTES = 16_384
MAX_BATCH = 200
_REVISION_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")


def _valid_revision(value: str) -> bool:
    """New client revisions are canonical UTC instants, safe to order as text."""
    if not _REVISION_RE.fullmatch(value):
        return False
    try:
        datetime.fromisoformat(f"{value[:-1]}+00:00")
    except ValueError:
        return False
    return True


class EntryValidationError(ValueError):
    pass


@dataclass(frozen=True)
class Entry:
    kind: str
    client_id: str
    at: str
    updated_at: str
    payload_json: str


def validate_entry(
    kind: str, client_id: str, at: str, payload_json: str, updated_at: str | None = None
) -> Entry:
    if kind not in ALLOWED_KINDS:
        raise EntryValidationError(f"unknown kind: {kind!r}")
    if not client_id or len(client_id) > MAX_CLIENT_ID:
        raise EntryValidationError("bad client_id")
    if not isinstance(at, str) or not (4 <= len(at) <= 40):
        raise EntryValidationError("bad timestamp")
    has_explicit_revision = updated_at is not None and updated_at != ""
    if not has_explicit_revision:
        updated_at = at  # backward compatibility with clients before revisions
    if not isinstance(updated_at, str) or not (4 <= len(updated_at) <= 40):
        raise EntryValidationError("bad updated_at")
    if has_explicit_revision and not _valid_revision(updated_at):
        raise EntryValidationError("bad updated_at")
    if len(payload_json.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise EntryValidationError("payload too large")
    try:
        payload = json.loads(payload_json)
    except (TypeError, json.JSONDecodeError) as exc:
        raise EntryValidationError("payload is not JSON") from exc
    if not isinstance(payload, dict):
        raise EntryValidationError("payload is not an object")
    return Entry(
        kind=kind, client_id=client_id, at=at, updated_at=updated_at, payload_json=payload_json
    )
