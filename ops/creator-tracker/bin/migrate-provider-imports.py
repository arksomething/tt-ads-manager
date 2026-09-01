#!/usr/bin/python3 -I
"""Copy a flat owner-private provider import set into root staging safely."""

from __future__ import annotations

import json
import os
import re
import stat
import sys


MAX_FILE_BYTES = 64 * 1024 * 1024
SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,254}\Z")


def fail(message: str) -> "None":
    raise RuntimeError(f"creator-tracker provider import migration: {message}")


def stable(value: os.stat_result) -> tuple[int, ...]:
    return (
        value.st_dev, value.st_ino, value.st_mode, value.st_nlink,
        value.st_uid, value.st_gid, value.st_size, value.st_mtime_ns,
        value.st_ctime_ns,
    )


def main() -> None:
    if os.geteuid() != 0 or len(sys.argv) != 5:
        fail("usage: migrate-provider-imports.py SOURCE_DIR TARGET_DIR WRITER_UID WRITER_GID")
    source, target = sys.argv[1], sys.argv[2]
    if not source.startswith("/home/ark296/") or os.path.normpath(source) != source:
        fail("source directory is not the fixed owner tree")
    if not target.startswith("/var/lib/creator-tracker/migration-staging/") or os.path.normpath(target) != target:
        fail("target directory is not root staging")
    writer_uid, writer_gid = int(sys.argv[3]), int(sys.argv[4])
    source_fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    target_fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        source_stat = os.fstat(source_fd)
        target_stat = os.fstat(target_fd)
        if (
            source_stat.st_uid != 1000
            or stat.S_IMODE(source_stat.st_mode) != 0o700
            or target_stat.st_uid != 0
            or target_stat.st_gid != 0
            or stat.S_IMODE(target_stat.st_mode) != 0o700
        ):
            fail("source or target directory identity is invalid")
        names = sorted(os.listdir(source_fd))
        for name in names:
            if not SAFE_NAME.fullmatch(name) or name in {".", ".."}:
                fail("provider import filename is unsafe")
            source_file = os.open(
                name,
                os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
                dir_fd=source_fd,
            )
            try:
                before = os.fstat(source_file)
                if (
                    not stat.S_ISREG(before.st_mode)
                    or before.st_uid != 1000
                    or before.st_nlink != 1
                    or stat.S_IMODE(before.st_mode) != 0o600
                    or before.st_size < 1
                    or before.st_size > MAX_FILE_BYTES
                ):
                    fail("provider import source file is unsafe")
                contents = bytearray()
                while chunk := os.read(source_file, 1024 * 1024):
                    contents.extend(chunk)
                    if len(contents) > MAX_FILE_BYTES:
                        fail("provider import source file exceeds its bound")
                if stable(os.fstat(source_file)) != stable(before):
                    fail("provider import source changed while being read")
                try:
                    json.loads(contents.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    fail("provider import source is not valid UTF-8 JSON")
                destination = os.open(
                    name,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    0o600,
                    dir_fd=target_fd,
                )
                try:
                    offset = 0
                    while offset < len(contents):
                        offset += os.write(destination, contents[offset:])
                    os.fchmod(destination, 0o600)
                    os.fchown(destination, writer_uid, writer_gid)
                    os.fsync(destination)
                finally:
                    os.close(destination)
                contents.clear()
            finally:
                os.close(source_file)
        if stable(os.fstat(source_fd)) != stable(source_stat):
            fail("provider import source directory changed during migration")
        os.fsync(target_fd)
    finally:
        os.close(target_fd)
        os.close(source_fd)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
