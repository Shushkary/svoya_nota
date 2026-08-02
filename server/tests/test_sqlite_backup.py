import sqlite3
from datetime import datetime, timezone

from nota.adapters.sqlite_backup import create_sqlite_backup


def test_backup_uses_consistent_sqlite_snapshot_and_verifies_it(tmp_path):
    source = tmp_path / "nota.db"
    with sqlite3.connect(source) as conn:
        conn.execute("CREATE TABLE entries (value TEXT)")
        conn.execute("INSERT INTO entries(value) VALUES ('kept')")

    backup = create_sqlite_backup(
        source, tmp_path / "backups", now=datetime(2026, 7, 28, 12, 0, tzinfo=timezone.utc)
    )

    assert backup.name == "nota-20260728T120000Z.db"
    with sqlite3.connect(backup) as conn:
        assert conn.execute("SELECT value FROM entries").fetchone()[0] == "kept"
        assert conn.execute("PRAGMA quick_check").fetchone()[0] == "ok"
