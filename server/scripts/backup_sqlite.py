"""Create a verified, consistent backup of the Svoya Nota SQLite database."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from nota.adapters.sqlite_backup import create_sqlite_backup


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", default=os.environ.get("NOTA_DB_PATH", "./nota.db"))
    parser.add_argument("--destination", required=True, help="directory for immutable backup files")
    args = parser.parse_args()
    created = create_sqlite_backup(args.database, args.destination)
    print(created)


if __name__ == "__main__":
    main()
