"""Consistent, verified SQLite backups made through the SQLite backup API."""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def create_sqlite_backup(
    database_path: str | Path, destination_dir: str | Path, *, now: datetime | None = None
) -> Path:
    """Create an atomic backup that remains consistent while the app is writing.

    Copying a WAL-mode database file directly may omit uncheckpointed changes.
    sqlite3.Connection.backup() takes a consistent snapshot instead; quick_check
    verifies the resulting copy before it becomes visible to backup tooling.
    """
    source_path = Path(database_path).expanduser().resolve()
    if not source_path.is_file():
        raise FileNotFoundError(f"SQLite database was not found: {source_path}")
    target_dir = Path(destination_dir).expanduser().resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    moment = now or datetime.now(timezone.utc)
    target = target_dir / f"{source_path.stem}-{moment.strftime('%Y%m%dT%H%M%SZ')}.db"
    temporary = target.with_suffix(".tmp")
    if temporary.exists():
        temporary.unlink()

    source = sqlite3.connect(f"file:{source_path.as_posix()}?mode=ro", uri=True)
    destination = sqlite3.connect(temporary)
    try:
        source.backup(destination)
        result = destination.execute("PRAGMA quick_check").fetchone()[0]
        if result != "ok":
            raise sqlite3.DatabaseError(f"backup integrity check failed: {result}")
    except Exception:
        destination.close()
        temporary.unlink(missing_ok=True)
        raise
    else:
        destination.close()
        os.replace(temporary, target)
        return target
    finally:
        source.close()
