import sqlite3

import pytest

from nota.adapters.sqlite_repository import SqliteRepository


def test_repository_marks_current_schema_version(tmp_path):
    path = tmp_path / "nota.db"
    SqliteRepository(str(path))

    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 3


def test_repository_refuses_database_from_newer_application(tmp_path):
    path = tmp_path / "future.db"
    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA user_version = 999")

    with pytest.raises(RuntimeError, match="newer than supported"):
        SqliteRepository(str(path))


def test_repository_health_runs_sqlite_integrity_check(tmp_path):
    repo = SqliteRepository(str(tmp_path / "nota.db"))

    assert repo.is_healthy() is True
    assert repo._last_integrity_check > 0


def test_repository_migrates_v1_entries_to_client_revision(tmp_path):
    path = tmp_path / "v1.db"
    with sqlite3.connect(path) as conn:
        conn.executescript("""
            CREATE TABLE devices (id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
            CREATE TABLE entries (
              device_id INTEGER NOT NULL, kind TEXT NOT NULL, client_id TEXT NOT NULL,
              at TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
              PRIMARY KEY (device_id, kind, client_id)
            );
            INSERT INTO devices(id, token_hash, created_at) VALUES(1, 'token', '2026-01-01');
            INSERT INTO entries(device_id, kind, client_id, at, payload, updated_at)
              VALUES(1, 'meal', 'm1', '2026-01-02T10:00:00Z', '{}', '2026-01-02T10:00:01Z');
            PRAGMA user_version = 1;
        """)

    repo = SqliteRepository(str(path))

    assert repo.snapshot(1)[0]["updatedAt"] == "2026-01-02T10:00:00Z"
