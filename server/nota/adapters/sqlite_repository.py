"""SQLite-репозиторий. Один файл БД, WAL, идемпотентный upsert по client_id.

SQLite выбран сознательно: на ВМ 1 ГБ RAM он не добавляет процессов, а объём
данных — личный журнал. Репозиторий скрыт за портом Repository; переход на
PostgreSQL — новый адаптер, домен и use cases не меняются.
"""

from __future__ import annotations

import sqlite3
import threading
import json
import time
from datetime import datetime, timezone

from nota.application.ports import CachedBarcodeLookup, PhotoAnalysisClaim
from nota.domain.barcode import BarcodeProduct
from nota.domain.entries import Entry

_SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  client_id TEXT NOT NULL,
  at TEXT NOT NULL,
  client_updated_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, kind, client_id)
);
CREATE INDEX IF NOT EXISTS idx_entries_device_at ON entries(device_id, at);
CREATE TABLE IF NOT EXISTS usage (
  device_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, day, kind)
);
CREATE TABLE IF NOT EXISTS ai_consents (
  device_id INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK(granted IN (0, 1)),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS data_consents (
  device_id INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK(granted IN (0, 1)),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photo_trial_usage (
  device_id INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  success_count INTEGER NOT NULL DEFAULT 0 CHECK(success_count >= 0),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS photo_analysis_requests (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing', 'completed', 'failed')),
  response_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, key_hash)
);
CREATE INDEX IF NOT EXISTS idx_photo_requests_status_updated
  ON photo_analysis_requests(status, updated_at);
CREATE TABLE IF NOT EXISTS barcode_cache (
  code TEXT PRIMARY KEY,
  product_json TEXT,
  source TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_barcode_cache_expires_at ON barcode_cache(expires_at);
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL DEFAULT '',
  discount_percent REAL NOT NULL DEFAULT 0,
  reward_percent REAL NOT NULL DEFAULT 0,
  owner_contact TEXT NOT NULL DEFAULT '',
  payment_details TEXT NOT NULL DEFAULT '',
  visits INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);
"""
_SCHEMA_VERSION = 3
_HEALTH_CHECK_INTERVAL_SECONDS = 60


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class SqliteRepository:
    def __init__(self, path: str):
        self._path = path
        self._lock = threading.Lock()
        self._health_lock = threading.Lock()
        self._local = threading.local()
        self._last_integrity_check = 0.0
        self._integrity_ok = True
        with self._connect() as conn:
            self._migrate(conn)

    def _connect(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self._path, timeout=15)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=15000")
            self._local.conn = conn
        return conn

    @staticmethod
    def _migrate(conn: sqlite3.Connection) -> None:
        """Apply the current baseline and reserve PRAGMA user_version for upgrades."""
        current = int(conn.execute("PRAGMA user_version").fetchone()[0])
        if current > _SCHEMA_VERSION:
            raise RuntimeError(
                f"database schema {current} is newer than supported {_SCHEMA_VERSION}"
            )
        conn.executescript(_SCHEMA)
        if current < 2:
            columns = {
                row["name"] for row in conn.execute("PRAGMA table_info(entries)").fetchall()
            }
            if "client_updated_at" not in columns:
                conn.execute(
                    "ALTER TABLE entries ADD COLUMN client_updated_at TEXT NOT NULL DEFAULT ''"
                )
            conn.execute(
                "UPDATE entries SET client_updated_at = at WHERE client_updated_at = ''"
            )
        if current < _SCHEMA_VERSION:
            conn.execute(f"PRAGMA user_version = {_SCHEMA_VERSION}")

    def is_healthy(self) -> bool:
        try:
            conn = self._connect()
            conn.execute("SELECT 1").fetchone()
            now = time.monotonic()
            with self._health_lock:
                if now - self._last_integrity_check >= _HEALTH_CHECK_INTERVAL_SECONDS:
                    self._integrity_ok = conn.execute("PRAGMA quick_check(1)").fetchone()[0] == "ok"
                    self._last_integrity_check = now
                return self._integrity_ok
        except sqlite3.Error:
            return False

    # ── devices ───────────────────────────────────────────────────
    def create_device(self, token_hash: str, data_consent_version: str) -> int:
        conn = self._connect()
        with conn:
            cur = conn.execute(
                "INSERT INTO devices(token_hash, created_at) VALUES(?, ?)",
                (token_hash, _now()),
            )
            conn.execute(
                """
                INSERT INTO data_consents(device_id, version, granted, updated_at)
                VALUES(?, ?, 1, ?)
                """,
                (int(cur.lastrowid), data_consent_version, _now()),
            )
        return int(cur.lastrowid)

    def device_id_by_token_hash(self, token_hash: str) -> int | None:
        row = self._connect().execute(
            "SELECT id FROM devices WHERE token_hash = ?", (token_hash,)
        ).fetchone()
        return int(row["id"]) if row else None

    # ── entries ───────────────────────────────────────────────────
    def upsert_entries(self, device_id: int, entries: list[Entry]) -> list[Entry]:
        conn = self._connect()
        now = _now()
        with conn:
            for entry in entries:
                conn.execute(
                    """
                    INSERT INTO entries(
                      device_id, kind, client_id, at, client_updated_at, payload, updated_at
                    ) VALUES(?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(device_id, kind, client_id) DO UPDATE SET
                      at = excluded.at,
                      client_updated_at = excluded.client_updated_at,
                      payload = excluded.payload,
                      updated_at = excluded.updated_at
                    WHERE excluded.client_updated_at > entries.client_updated_at
                       OR (
                         excluded.client_updated_at = entries.client_updated_at
                         AND excluded.at = entries.at
                         AND excluded.payload = entries.payload
                       )
                    """,
                    (
                        device_id, entry.kind, entry.client_id, entry.at,
                        entry.updated_at, entry.payload_json, now,
                    ),
                )
            stored = []
            for entry in entries:
                row = conn.execute(
                    """
                    SELECT kind, client_id, at, client_updated_at, payload
                    FROM entries WHERE device_id = ? AND kind = ? AND client_id = ?
                    """,
                    (device_id, entry.kind, entry.client_id),
                ).fetchone()
                stored.append(Entry(
                    kind=row["kind"], client_id=row["client_id"], at=row["at"],
                    updated_at=row["client_updated_at"], payload_json=row["payload"],
                ))
        return stored

    def snapshot(self, device_id: int) -> list[dict]:
        rows = self._connect().execute(
            "SELECT kind, client_id, at, client_updated_at, payload FROM entries WHERE device_id = ? ORDER BY at",
            (device_id,),
        ).fetchall()
        return [
            {
                "kind": r["kind"], "clientId": r["client_id"], "at": r["at"],
                "updatedAt": r["client_updated_at"], "payload": r["payload"],
            }
            for r in rows
        ]

    def delete_device_data(self, device_id: int) -> None:
        conn = self._connect()
        with conn:
            conn.execute("DELETE FROM devices WHERE id = ?", (device_id,))
            conn.execute("DELETE FROM usage WHERE device_id = ?", (device_id,))

    def set_ai_consent(self, device_id: int, version: str, granted: bool) -> None:
        conn = self._connect()
        with conn:
            conn.execute(
                """
                INSERT INTO ai_consents(device_id, version, granted, updated_at)
                VALUES(?, ?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET
                  version = excluded.version, granted = excluded.granted, updated_at = excluded.updated_at
                """,
                (device_id, version, int(granted), _now()),
            )

    def has_ai_consent(self, device_id: int, version: str) -> bool:
        row = self._connect().execute(
            "SELECT granted FROM ai_consents WHERE device_id = ? AND version = ?",
            (device_id, version),
        ).fetchone()
        return bool(row and row["granted"])

    def set_data_consent(self, device_id: int, version: str, granted: bool) -> None:
        conn = self._connect()
        with conn:
            conn.execute(
                """
                INSERT INTO data_consents(device_id, version, granted, updated_at)
                VALUES(?, ?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET
                  version = excluded.version, granted = excluded.granted,
                  updated_at = excluded.updated_at
                """,
                (device_id, version, int(granted), _now()),
            )

    def has_data_consent(self, device_id: int, version: str) -> bool:
        row = self._connect().execute(
            "SELECT granted FROM data_consents WHERE device_id = ? AND version = ?",
            (device_id, version),
        ).fetchone()
        return bool(row and row["granted"])

    # ── usage ─────────────────────────────────────────────────────
    def reserve_usage(
        self, device_id: int, day: str, kind: str, per_device_limit: int, global_limit: int
    ) -> bool:
        conn = self._connect()
        with self._lock, conn:
            row = conn.execute(
                "SELECT count FROM usage WHERE device_id = ? AND day = ? AND kind = ?",
                (device_id, day, kind),
            ).fetchone()
            device_count = int(row["count"]) if row else 0
            if device_count >= per_device_limit:
                return False
            total = conn.execute(
                "SELECT COALESCE(SUM(count), 0) AS total FROM usage WHERE day = ?", (day,)
            ).fetchone()
            if int(total["total"]) >= global_limit:
                return False
            conn.execute(
                """
                INSERT INTO usage(device_id, day, kind, count) VALUES(?, ?, ?, 1)
                ON CONFLICT(device_id, day, kind) DO UPDATE SET count = count + 1
                """,
                (device_id, day, kind),
            )
        return True

    def refund_usage(self, device_id: int, day: str, kind: str) -> None:
        conn = self._connect()
        with self._lock, conn:
            conn.execute(
                """
                UPDATE usage SET count = count - 1
                WHERE device_id = ? AND day = ? AND kind = ? AND count > 0
                """,
                (device_id, day, kind),
            )

    # -- photo AI trial / idempotency -----------------------------------------
    def claim_photo_analysis(
        self,
        device_id: int,
        key_hash: str,
        request_hash: str,
        now_epoch: int,
        processing_ttl_seconds: int,
        cache_ttl_seconds: int,
        lifetime_limit: int,
        per_device_concurrent: int,
        global_concurrent: int,
    ) -> PhotoAnalysisClaim:
        """Reserve a trial slot and an idempotency key in one SQLite transaction.

        Only a completed request is charged. Processing rows temporarily reserve a
        slot so concurrent requests cannot overshoot the lifetime entitlement.
        The database stores neither the image nor a network address.
        """
        conn = self._connect()
        stale_before = now_epoch - max(1, processing_ttl_seconds)
        cache_before = now_epoch - max(processing_ttl_seconds, cache_ttl_seconds)
        with self._lock:
            conn.execute("BEGIN IMMEDIATE")
            try:
                conn.execute(
                    "DELETE FROM photo_analysis_requests "
                    "WHERE status != 'processing' AND updated_at < ?",
                    (cache_before,),
                )
                conn.execute(
                    "DELETE FROM photo_analysis_requests "
                    "WHERE status = 'processing' AND updated_at < ?",
                    (cache_before,),
                )

                existing = conn.execute(
                    """
                    SELECT request_hash, status, response_json, updated_at
                    FROM photo_analysis_requests
                    WHERE device_id = ? AND key_hash = ?
                    """,
                    (device_id, key_hash),
                ).fetchone()
                if existing is not None:
                    if existing["request_hash"] != request_hash:
                        conn.commit()
                        return PhotoAnalysisClaim("conflict")
                    if existing["status"] == "completed":
                        used = self._photo_trial_success_count_conn(conn, device_id)
                        conn.commit()
                        return PhotoAnalysisClaim(
                            "replay",
                            response_json=existing["response_json"],
                            remaining=max(0, lifetime_limit - used),
                        )
                    if (
                        existing["status"] == "processing"
                        and int(existing["updated_at"]) >= stale_before
                    ):
                        conn.commit()
                        return PhotoAnalysisClaim("in_progress")

                used = self._photo_trial_success_count_conn(conn, device_id)
                active_for_device = int(
                    conn.execute(
                        """
                        SELECT COUNT(*) AS count FROM photo_analysis_requests
                        WHERE device_id = ? AND status = 'processing' AND updated_at >= ?
                        """,
                        (device_id, stale_before),
                    ).fetchone()["count"]
                )
                if used >= lifetime_limit or used + active_for_device >= lifetime_limit:
                    conn.commit()
                    return PhotoAnalysisClaim("quota", remaining=0)
                if active_for_device >= max(1, per_device_concurrent):
                    conn.commit()
                    return PhotoAnalysisClaim("busy")
                active_global = int(
                    conn.execute(
                        """
                        SELECT COUNT(*) AS count FROM photo_analysis_requests
                        WHERE status = 'processing' AND updated_at >= ?
                        """,
                        (stale_before,),
                    ).fetchone()["count"]
                )
                if active_global >= max(1, global_concurrent):
                    conn.commit()
                    return PhotoAnalysisClaim("busy")

                conn.execute(
                    """
                    INSERT INTO photo_analysis_requests(
                      device_id, key_hash, request_hash, status, response_json,
                      created_at, updated_at
                    ) VALUES(?, ?, ?, 'processing', NULL, ?, ?)
                    ON CONFLICT(device_id, key_hash) DO UPDATE SET
                      status = 'processing', response_json = NULL, updated_at = excluded.updated_at
                    """,
                    (device_id, key_hash, request_hash, now_epoch, now_epoch),
                )
                conn.commit()
                return PhotoAnalysisClaim(
                    "acquired", remaining=max(0, lifetime_limit - used)
                )
            except Exception:
                conn.rollback()
                raise

    def complete_photo_analysis(
        self,
        device_id: int,
        key_hash: str,
        request_hash: str,
        response_json: str,
        now_epoch: int,
        lifetime_limit: int,
    ) -> int:
        conn = self._connect()
        with self._lock:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute(
                    """
                    SELECT request_hash, status FROM photo_analysis_requests
                    WHERE device_id = ? AND key_hash = ?
                    """,
                    (device_id, key_hash),
                ).fetchone()
                if row is None or row["request_hash"] != request_hash:
                    raise RuntimeError("photo analysis claim is missing")
                used = self._photo_trial_success_count_conn(conn, device_id)
                if row["status"] == "completed":
                    conn.commit()
                    return max(0, lifetime_limit - used)
                if row["status"] != "processing":
                    raise RuntimeError("photo analysis claim is not active")
                if used >= lifetime_limit:
                    conn.execute(
                        """
                        UPDATE photo_analysis_requests
                        SET status = 'failed', response_json = NULL, updated_at = ?
                        WHERE device_id = ? AND key_hash = ?
                        """,
                        (now_epoch, device_id, key_hash),
                    )
                    conn.commit()
                    return 0
                conn.execute(
                    """
                    INSERT INTO photo_trial_usage(device_id, success_count, updated_at)
                    VALUES(?, 1, ?)
                    ON CONFLICT(device_id) DO UPDATE SET
                      success_count = success_count + 1, updated_at = excluded.updated_at
                    """,
                    (device_id, now_epoch),
                )
                conn.execute(
                    """
                    UPDATE photo_analysis_requests
                    SET status = 'completed', response_json = ?, updated_at = ?
                    WHERE device_id = ? AND key_hash = ?
                    """,
                    (response_json, now_epoch, device_id, key_hash),
                )
                conn.commit()
                return max(0, lifetime_limit - used - 1)
            except Exception:
                conn.rollback()
                raise

    def fail_photo_analysis(
        self, device_id: int, key_hash: str, request_hash: str, now_epoch: int
    ) -> None:
        conn = self._connect()
        with self._lock, conn:
            conn.execute(
                """
                UPDATE photo_analysis_requests
                SET status = 'failed', response_json = NULL, updated_at = ?
                WHERE device_id = ? AND key_hash = ? AND request_hash = ?
                  AND status = 'processing'
                """,
                (now_epoch, device_id, key_hash, request_hash),
            )

    @staticmethod
    def _photo_trial_success_count_conn(conn: sqlite3.Connection, device_id: int) -> int:
        row = conn.execute(
            "SELECT success_count FROM photo_trial_usage WHERE device_id = ?", (device_id,)
        ).fetchone()
        return int(row["success_count"]) if row else 0

    def photo_trial_success_count(self, device_id: int) -> int:
        return self._photo_trial_success_count_conn(self._connect(), device_id)

    # -- referrals (партнёрская / реферальная программа) ----------------------
    def create_referral(
        self,
        code: str,
        label: str,
        target_url: str,
        discount_percent: float,
        reward_percent: float,
        owner_contact: str,
        payment_details: str,
    ) -> int:
        conn = self._connect()
        now = _now()
        with conn:
            cur = conn.execute(
                """
                INSERT INTO referrals(
                  code, label, target_url, discount_percent, reward_percent,
                  owner_contact, payment_details, created_at, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (code, label, target_url, discount_percent, reward_percent,
                 owner_contact, payment_details, now, now),
            )
        return int(cur.lastrowid)

    def list_referrals(self) -> list[dict]:
        rows = self._connect().execute(
            "SELECT * FROM referrals ORDER BY created_at DESC, id DESC"
        ).fetchall()
        return [{k: row[k] for k in row.keys()} for row in rows]

    def get_referral_by_code(self, code: str) -> dict | None:
        row = self._connect().execute(
            "SELECT * FROM referrals WHERE code = ?", (code,)
        ).fetchone()
        return {k: row[k] for k in row.keys()} if row else None

    def update_referral(self, referral_id: int, fields: dict) -> None:
        fields = {k: v for k, v in fields.items() if v is not None}
        if not fields:
            return
        fields["updated_at"] = _now()
        cols = ", ".join(f"{k} = ?" for k in fields)
        conn = self._connect()
        with conn:
            conn.execute(
                f"UPDATE referrals SET {cols} WHERE id = ?",
                (*fields.values(), referral_id),
            )

    def delete_referral(self, referral_id: int) -> None:
        conn = self._connect()
        with conn:
            conn.execute("DELETE FROM referrals WHERE id = ?", (referral_id,))

    def increment_referral_visit(self, code: str) -> dict | None:
        conn = self._connect()
        with self._lock, conn:
            row = conn.execute(
                "SELECT * FROM referrals WHERE code = ? AND active = 1", (code,)
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                "UPDATE referrals SET visits = visits + 1 WHERE id = ?", (row["id"],)
            )
        return {k: row[k] for k in row.keys()}

    # -- shared public product cache -----------------------------------------
    def cached_barcode(self, code: str, now_epoch: int) -> CachedBarcodeLookup:
        conn = self._connect()
        row = conn.execute(
            "SELECT product_json FROM barcode_cache WHERE code = ? AND expires_at > ?",
            (code, now_epoch),
        ).fetchone()
        if row is None:
            return CachedBarcodeLookup(False)
        raw = row["product_json"]
        if raw is None:
            return CachedBarcodeLookup(True)
        try:
            data = json.loads(raw)
            return CachedBarcodeLookup(True, BarcodeProduct(**data))
        except (TypeError, ValueError, json.JSONDecodeError):
            # A damaged cache entry must not make the nutrition screen unusable.
            with conn:
                conn.execute("DELETE FROM barcode_cache WHERE code = ?", (code,))
            return CachedBarcodeLookup(False)

    def cache_barcode(
        self, product: BarcodeProduct | None, code: str, now_epoch: int, ttl_seconds: int
    ) -> None:
        payload = json.dumps(product.__dict__, ensure_ascii=False, separators=(",", ":")) if product else None
        source = product.source if product else "open_food_facts"
        conn = self._connect()
        with conn:
            conn.execute(
                """
                INSERT INTO barcode_cache(code, product_json, source, fetched_at, expires_at)
                VALUES(?, ?, ?, ?, ?)
                ON CONFLICT(code) DO UPDATE SET
                  product_json = excluded.product_json, source = excluded.source,
                  fetched_at = excluded.fetched_at, expires_at = excluded.expires_at
                """,
                (code, payload, source, now_epoch, now_epoch + max(60, ttl_seconds)),
            )
