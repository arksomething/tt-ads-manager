#!/usr/bin/python3 -I
"""Exercise SQLite WAL creation/read access under the configured service UID."""

from __future__ import annotations

import os
import sqlite3
import sys
import time
from pathlib import Path
from urllib.parse import quote


def fail(message: str) -> "None":
    raise RuntimeError(f"creator-tracker database access probe: {message}")


def connect(path: str, readonly: bool) -> sqlite3.Connection:
    mode = "ro" if readonly else "rw"
    return sqlite3.connect(f"file:{quote(path)}?mode={mode}", uri=True, timeout=5)


def writer(database_path: str, ready_path: str, stop_path: str) -> None:
    database = connect(database_path, False)
    try:
        if str(database.execute("PRAGMA journal_mode=WAL").fetchone()[0]).lower() != "wal":
            fail("writer could not retain WAL mode")
        database.execute("BEGIN IMMEDIATE")
        database.rollback()
        Path(ready_path).write_text("ready\n", encoding="ascii")
        deadline = time.monotonic() + 30
        while not os.path.exists(stop_path):
            if time.monotonic() >= deadline:
                fail("writer probe timed out awaiting the reader checks")
            time.sleep(0.05)
    finally:
        database.close()


def reader(database_path: str) -> None:
    try:
        descriptor = os.open(database_path, os.O_WRONLY | os.O_NOFOLLOW)
    except PermissionError:
        pass
    else:
        os.close(descriptor)
        fail("read-only service identity has filesystem write access")
    database = connect(database_path, True)
    try:
        if [str(row[0]) for row in database.execute("PRAGMA quick_check")] != ["ok"]:
            fail("reader quick_check failed")
        database.execute("SELECT count(*) FROM sqlite_master").fetchone()
        try:
            database.execute("CREATE TABLE creator_tracker_probe_forbidden(value INTEGER)")
        except sqlite3.DatabaseError:
            pass
        else:
            fail("read-only role unexpectedly wrote the database")
    finally:
        database.close()


def main() -> None:
    if len(sys.argv) == 5 and sys.argv[1] == "writer":
        writer(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) == 3 and sys.argv[1] == "reader":
        reader(sys.argv[2])
    else:
        fail("usage: probe-database-access.py writer DATABASE READY STOP | reader DATABASE")


try:
    main()
except Exception as error:
    print(str(error), file=sys.stderr)
    raise SystemExit(1)
