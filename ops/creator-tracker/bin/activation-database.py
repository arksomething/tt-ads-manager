#!/usr/bin/python3 -I
"""Trusted SQLite activation backup/verification helper."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import stat
import sys
from urllib.parse import quote


def fail(message: str) -> "None":
    raise RuntimeError(f"creator-tracker activation database: {message}")


def canonical(path: str) -> str:
    if not path.startswith("/") or os.path.normpath(path) != path:
        fail("paths must be canonical and absolute")
    return path


def safe_regular(path: str, *, owner: int | None = None) -> os.stat_result:
    before = os.lstat(path)
    if (
        not stat.S_ISREG(before.st_mode)
        or before.st_nlink != 1
        or (owner is not None and before.st_uid != owner)
        or before.st_mode & 0o002
    ):
        fail(f"unsafe regular file: {path}")
    return before


def connect_readonly(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{quote(path)}?mode=ro", uri=True)


def stable_identity(value: os.stat_result) -> tuple[int, ...]:
    return (
        value.st_dev, value.st_ino, value.st_mode, value.st_nlink,
        value.st_uid, value.st_gid, value.st_size, value.st_mtime_ns,
        value.st_ctime_ns,
    )


def open_descriptors() -> set[int]:
    return {
        int(name) for name in os.listdir("/proc/self/fd")
        if name.isdigit() and os.path.exists(f"/proc/self/fd/{name}")
    }


def assert_connection_inode(before_fds: set[int], expected: os.stat_result) -> None:
    matches = []
    for fd in open_descriptors() - before_fds:
        try:
            opened = os.fstat(fd)
        except OSError:
            continue
        if stat.S_ISREG(opened.st_mode) and (
            opened.st_dev, opened.st_ino
        ) == (expected.st_dev, expected.st_ino):
            matches.append(fd)
    if len(matches) != 1:
        fail("SQLite connection did not bind the expected database inode")


def read_regular(path: str, *, owner: int | None = None) -> bytes:
    before = safe_regular(path, owner=owner)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0))
    try:
        opened = os.fstat(fd)
        if stable_identity(opened) != stable_identity(before):
            fail(f"regular file changed while being opened: {path}")
        chunks = []
        while chunk := os.read(fd, 1024 * 1024):
            chunks.append(chunk)
        after = os.fstat(fd)
        if stable_identity(after) != stable_identity(opened):
            fail(f"regular file changed while being read: {path}")
        return b"".join(chunks)
    finally:
        os.close(fd)


def snapshot(database: sqlite3.Connection) -> dict[str, object]:
    integrity = [str(row[0]) for row in database.execute("PRAGMA quick_check")]
    if integrity != ["ok"]:
        fail("SQLite quick_check failed")
    objects = [
        {"type": row[0], "name": row[1], "tableName": row[2], "sql": row[3] or ""}
        for row in database.execute(
            "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master "
            "WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
        )
    ]
    rows: dict[str, int] = {}
    for item in objects:
        if item["type"] != "table":
            continue
        table = str(item["name"])
        if not table.replace("_", "a").isalnum() or not (table[0].isalpha() or table[0] == "_"):
            fail("unsafe table name in database")
        rows[table] = int(database.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0])
    schema = hashlib.sha256(json.dumps(objects, separators=(",", ":")).encode()).hexdigest()
    return {"integrity": integrity, "schemaSha256": schema, "rows": rows}


def file_sha(path: str) -> str:
    digest = hashlib.sha256()
    before = safe_regular(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        if stable_identity(opened) != stable_identity(before):
            fail(f"file changed while being opened for hashing: {path}")
        while chunk := os.read(fd, 1024 * 1024):
            digest.update(chunk)
        if stable_identity(os.fstat(fd)) != stable_identity(opened):
            fail(f"file changed while being hashed: {path}")
    finally:
        os.close(fd)
    return digest.hexdigest()


def backup(source: str, destination: str, manifest_path: str) -> None:
    source = canonical(source)
    destination = canonical(destination)
    manifest_path = canonical(manifest_path)
    before = safe_regular(source)
    if os.path.lexists(destination) or os.path.lexists(manifest_path):
        fail("backup destination or manifest already exists")
    before_fds = open_descriptors()
    source_db = connect_readonly(source)
    try:
        assert_connection_inode(before_fds, before)
        source_db.execute("BEGIN")
        source_snapshot = snapshot(source_db)
        copied = sqlite3.connect(destination)
        try:
            source_db.backup(copied)
        finally:
            copied.close()
        source_db.rollback()
    finally:
        source_db.close()
    if stable_identity(os.lstat(source)) != stable_identity(before):
        fail("source database identity changed during backup")
    os.chmod(destination, 0o600)
    safe_regular(destination, owner=0)
    copied = connect_readonly(destination)
    try:
        copied_snapshot = snapshot(copied)
    finally:
        copied.close()
    if source_snapshot != copied_snapshot:
        fail("backup schema or row counts differ from the source snapshot")
    manifest = {
        "formatVersion": 2,
        "source": source,
        "backup": destination,
        "databaseSha256": file_sha(destination),
        **copied_snapshot,
    }
    fd = os.open(manifest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.write(fd, (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode())
        os.fchmod(fd, 0o600)
        os.fsync(fd)
    finally:
        os.close(fd)


def verify(path: str, manifest_path: str) -> None:
    path = canonical(path)
    manifest_path = canonical(manifest_path)
    safe_regular(path, owner=0)
    safe_regular(manifest_path, owner=0)
    manifest = json.loads(read_regular(manifest_path, owner=0).decode("utf-8"))
    if (
        manifest.get("formatVersion") != 2
        or manifest.get("backup") != path
        or manifest.get("databaseSha256") != file_sha(path)
    ):
        fail("backup manifest identity or hash mismatch")
    database = connect_readonly(path)
    try:
        actual = snapshot(database)
    finally:
        database.close()
    expected = {key: manifest.get(key) for key in ("integrity", "schemaSha256", "rows")}
    if actual != expected:
        fail("backup integrity, schema, or row counts changed")


def assert_provider_lease_settled(path: str) -> None:
    """Refuse cutover while a paid-provider request may still own the lease."""
    path = canonical(path)
    before = safe_regular(path)
    before_fds = open_descriptors()
    database = connect_readonly(path)
    try:
        assert_connection_inode(before_fds, before)
        database.execute("BEGIN")
        table = database.execute(
            "SELECT count(*) FROM sqlite_master "
            "WHERE type = 'table' AND name = 'sync_state'"
        ).fetchone()
        if table is None or int(table[0]) != 1:
            fail("provider lease table is unavailable")
        rows = database.execute(
            "SELECT status, message FROM sync_state WHERE source = ?",
            ("instagram_provider_credit_guard",),
        ).fetchall()
        if len(rows) != 1:
            fail("provider lease state is missing or duplicated")
        status, message = rows[0]
        prefix = "instagram_credit_global_v1="
        if not isinstance(message, str) or not message.startswith(prefix):
            fail("provider lease state is malformed")
        try:
            serialized = message[len(prefix):]
            state = json.loads(serialized)
        except json.JSONDecodeError:
            fail("provider lease state is malformed")
        expected_keys = {
            "version", "state", "reason", "runId", "requestNumber",
            "reserveCredits", "creditsRemaining", "observedAtMs", "claimedAtMs",
        }
        if (
            not isinstance(state, dict)
            or set(state) != expected_keys
            or serialized != json.dumps(state, separators=(",", ":"))
            or state.get("version") != 1
            or state.get("state") not in {
                "ready", "blocked_low", "blocked_missing_telemetry",
                "request_pending",
            }
            or not isinstance(state.get("runId"), str)
            or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", state["runId"])
            is None
        ):
            fail("provider lease state is malformed")
        integer_bounds = {
            "requestNumber": 10_000,
            "reserveCredits": 100_000_000,
            "creditsRemaining": 100_000_000,
            "observedAtMs": 8_640_000_000_000_000,
            "claimedAtMs": 8_640_000_000_000_000,
        }
        for key, maximum in integer_bounds.items():
            value = state[key]
            if key in {"creditsRemaining", "observedAtMs", "claimedAtMs"} and value is None:
                continue
            if type(value) is not int or value < 0 or value > maximum:
                fail("provider lease state is malformed")
        if (
            state["requestNumber"] < 1
            or state["reserveCredits"] < 1
            or (state["creditsRemaining"] is None) != (state["observedAtMs"] is None)
        ):
            fail("provider lease state is malformed")
        state_name = state["state"]
        reason = state["reason"]
        claimed_at = state["claimedAtMs"]
        if (
            state_name == "ready"
            and (reason is not None or state["creditsRemaining"] is None or claimed_at is not None)
        ):
            fail("provider lease state is malformed")
        if state_name == "request_pending" and (
            reason != "request_pending" or claimed_at is None
        ):
            fail("provider lease state is malformed")
        if state_name == "blocked_low" and (
            reason not in {"balance_below_reserve", "reserve_would_be_crossed"}
            or state["creditsRemaining"] is None
            or claimed_at is not None
        ):
            fail("provider lease state is malformed")
        if state_name == "blocked_missing_telemetry" and (
            reason not in {
                "provider_telemetry_missing", "provider_charge_invalid",
                "balance_reconciliation_pending", "balance_reconciliation_failed",
                "balance_reconciliation_rate_limited", "evidence_malformed",
                "rearm_identity_invalid", "rearm_launch_balance_below_minimum",
            }
            or claimed_at is not None
        ):
            fail("provider lease state is malformed")
        if state_name == "request_pending" or status == "running":
            fail("paid-provider credit lease is still request_pending")
        expected_status = {
            "ready": "ok",
            "blocked_low": "error",
            "blocked_missing_telemetry": "error",
        }.get(state_name)
        if status != expected_status:
            fail("provider lease status is inconsistent")
        database.rollback()
    finally:
        database.close()
    if stable_identity(os.lstat(path)) != stable_identity(before):
        fail("provider lease database identity changed during inspection")


def main() -> None:
    if os.geteuid() != 0:
        fail("helper must run as root")
    if len(sys.argv) != 5 or sys.argv[1] not in {
        "backup", "verify", "assert-provider-lease-settled",
    }:
        fail(
            "usage: activation-database.py backup SOURCE BACKUP MANIFEST | "
            "verify BACKUP IGNORED MANIFEST | "
            "assert-provider-lease-settled DATABASE IGNORED IGNORED"
        )
    if sys.argv[1] == "backup":
        backup(sys.argv[2], sys.argv[3], sys.argv[4])
    elif sys.argv[1] == "verify":
        verify(sys.argv[2], sys.argv[4])
    else:
        assert_provider_lease_settled(sys.argv[2])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
