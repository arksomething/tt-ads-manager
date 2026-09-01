#!/usr/bin/python3 -I
"""Record and verify the exact mutable boundary for first-cutover restoration."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import sys
from collections.abc import Mapping
from typing import Literal


Kind = Literal[
    "file", "optional-file", "tree", "optional-tree", "optional-flat-tree",
]
Spec = tuple[Kind, str]

EXPECTED: dict[str, Spec] = {
    # This is a fixed single-file read, never a recursive root operation below
    # /home. A first-cutover restoration is safe only while the legacy source
    # database still matches the database that was transactionally migrated.
    "legacyDatabase": ("file", "/home/ark296/projects/gotall-viral-dash/data/gotall-viral.db"),
    "legacyDatabaseWal": (
        "optional-file",
        "/home/ark296/projects/gotall-viral-dash/data/gotall-viral.db-wal",
    ),
    "legacyDatabaseShm": (
        "optional-file",
        "/home/ark296/projects/gotall-viral-dash/data/gotall-viral.db-shm",
    ),
    "legacyDatabaseJournal": (
        "optional-file",
        "/home/ark296/projects/gotall-viral-dash/data/gotall-viral.db-journal",
    ),
    "legacyProviderImports": (
        # The legacy provider export is contractually flat. Keep the trusted
        # root process from recursively walking a caller-owned /home tree.
        "optional-flat-tree",
        "/home/ark296/projects/gotall-viral-dash/data/imports",
    ),
    "database": ("file", "/var/lib/creator-tracker/state/gotall-viral.db"),
    "databaseWal": ("optional-file", "/var/lib/creator-tracker/state/gotall-viral.db-wal"),
    "databaseShm": ("optional-file", "/var/lib/creator-tracker/state/gotall-viral.db-shm"),
    "databaseJournal": (
        "optional-file",
        "/var/lib/creator-tracker/state/gotall-viral.db-journal",
    ),
    "providerImports": ("tree", "/var/lib/creator-tracker/imports"),
    "rawEvidence": ("tree", "/var/lib/creator-tracker/raw-evidence-v1"),
    "verifiedRawEvidence": (
        "tree",
        "/var/lib/creator-tracker/verified-raw-evidence-v1",
    ),
    "configuration": ("tree", "/etc/creator-tracker"),
    "activationHistory": ("file", "/opt/creator-tracker/activation-history.tsv"),
    "tmpfilesDefinition": ("file", "/etc/tmpfiles.d/creator-tracker.conf"),
}


def fail(message: str) -> "None":
    raise RuntimeError(f"creator-tracker activation boundary: {message}")


def canonical(path: str) -> str:
    if not path.startswith("/") or os.path.normpath(path) != path:
        fail("paths must be canonical and absolute")
    return path


def metadata(value: os.stat_result) -> dict[str, int]:
    return {
        "device": value.st_dev,
        "inode": value.st_ino,
        "uid": value.st_uid,
        "gid": value.st_gid,
        "mode": stat.S_IMODE(value.st_mode),
        "links": value.st_nlink,
        "mtimeNs": value.st_mtime_ns,
        "ctimeNs": value.st_ctime_ns,
    }


def descriptor_digest(descriptor: int) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    while chunk := os.read(descriptor, 1024 * 1024):
        digest.update(chunk)
        size += len(chunk)
    return size, digest.hexdigest()


def open_file(path: str, *, directory_descriptor: int | None = None) -> int:
    flags = os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    return os.open(path, flags, dir_fd=directory_descriptor)


def capture_regular(
    path: str,
    *,
    directory_descriptor: int | None = None,
) -> dict[str, object]:
    descriptor = open_file(path, directory_descriptor=directory_descriptor)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            fail(f"not a single-link regular file: {path}")
        size, digest = descriptor_digest(descriptor)
        after = os.fstat(descriptor)
        if (
            before.st_dev,
            before.st_ino,
            before.st_mode,
            before.st_nlink,
            before.st_uid,
            before.st_gid,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_mode,
            after.st_nlink,
            after.st_uid,
            after.st_gid,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ):
            fail(f"file changed while it was fingerprinted: {path}")
        if size != before.st_size:
            fail(f"file size changed while it was fingerprinted: {path}")
        return {"type": "file", **metadata(before), "size": size, "sha256": digest}
    finally:
        os.close(descriptor)


def capture_tree(path: str) -> dict[str, object]:
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    root_descriptor = os.open(path, flags)
    try:
        root = os.fstat(root_descriptor)
        if not stat.S_ISDIR(root.st_mode):
            fail(f"tree root is not a real directory: {path}")
        entries: dict[str, dict[str, object]] = {".": {"type": "directory", **metadata(root)}}

        def walk(directory_descriptor: int, relative: str) -> None:
            directory_before = os.fstat(directory_descriptor)
            names = sorted(os.listdir(directory_descriptor))
            for name in names:
                if not name or name in {".", ".."} or "/" in name or "\x00" in name:
                    fail(f"unsafe tree entry below {path}")
                child_relative = name if relative == "." else f"{relative}/{name}"
                child = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
                if stat.S_ISDIR(child.st_mode):
                    child_descriptor = os.open(
                        name,
                        flags,
                        dir_fd=directory_descriptor,
                    )
                    try:
                        opened = os.fstat(child_descriptor)
                        if (opened.st_dev, opened.st_ino) != (child.st_dev, child.st_ino):
                            fail(f"directory changed while it was opened: {child_relative}")
                        entries[child_relative] = {
                            "type": "directory",
                            **metadata(opened),
                        }
                        walk(child_descriptor, child_relative)
                    finally:
                        os.close(child_descriptor)
                elif stat.S_ISREG(child.st_mode):
                    entries[child_relative] = capture_regular(
                        name,
                        directory_descriptor=directory_descriptor,
                    )
                else:
                    fail(f"tree contains a symlink or non-regular entry: {child_relative}")

            directory_after = os.fstat(directory_descriptor)
            before_identity = (
                directory_before.st_dev,
                directory_before.st_ino,
                directory_before.st_mode,
                directory_before.st_nlink,
                directory_before.st_uid,
                directory_before.st_gid,
                directory_before.st_mtime_ns,
                directory_before.st_ctime_ns,
            )
            after_identity = (
                directory_after.st_dev,
                directory_after.st_ino,
                directory_after.st_mode,
                directory_after.st_nlink,
                directory_after.st_uid,
                directory_after.st_gid,
                directory_after.st_mtime_ns,
                directory_after.st_ctime_ns,
            )
            if before_identity != after_identity:
                fail(f"directory changed while it was fingerprinted: {relative}")

        walk(root_descriptor, ".")
        return {"type": "tree", "entries": entries}
    finally:
        os.close(root_descriptor)


def capture_flat_tree(path: str) -> dict[str, object]:
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    root_descriptor = os.open(path, flags)
    try:
        before = os.fstat(root_descriptor)
        if not stat.S_ISDIR(before.st_mode):
            fail(f"flat tree root is not a real directory: {path}")
        entries: dict[str, dict[str, object]] = {
            ".": {"type": "directory", **metadata(before)},
        }
        for name in sorted(os.listdir(root_descriptor)):
            if not name or name in {".", ".."} or "/" in name or "\x00" in name:
                fail(f"unsafe flat tree entry below {path}")
            child = os.stat(name, dir_fd=root_descriptor, follow_symlinks=False)
            if not stat.S_ISREG(child.st_mode):
                fail(f"flat tree contains a nested or non-regular entry: {name}")
            entries[name] = capture_regular(
                name,
                directory_descriptor=root_descriptor,
            )
        after = os.fstat(root_descriptor)
        identity = lambda value: (
            value.st_dev, value.st_ino, value.st_mode, value.st_nlink,
            value.st_uid, value.st_gid, value.st_mtime_ns, value.st_ctime_ns,
        )
        if identity(before) != identity(after):
            fail("flat tree changed while it was fingerprinted")
        return {"type": "tree", "entries": entries}
    finally:
        os.close(root_descriptor)


def capture_inventory_once(specifications: Mapping[str, Spec]) -> dict[str, object]:
    inventory: dict[str, object] = {}
    for label in sorted(specifications):
        kind, raw_path = specifications[label]
        path = canonical(raw_path)
        if kind == "file":
            value = capture_regular(path)
        elif kind == "optional-file":
            try:
                os.lstat(path)
            except FileNotFoundError:
                value = {"type": "absent"}
            else:
                value = capture_regular(path)
        elif kind == "tree":
            value = capture_tree(path)
        elif kind == "optional-tree":
            try:
                os.lstat(path)
            except FileNotFoundError:
                value = {"type": "absent"}
            else:
                value = capture_tree(path)
        elif kind == "optional-flat-tree":
            try:
                os.lstat(path)
            except FileNotFoundError:
                value = {"type": "absent"}
            else:
                value = capture_flat_tree(path)
        else:
            fail(f"unknown inventory kind: {kind}")
        inventory[label] = {"path": path, **value}
    return inventory


def capture_inventory(specifications: Mapping[str, Spec]) -> dict[str, object]:
    # Every tree is descriptor-pinned internally and the complete inventory is
    # captured twice. This closes the directory-list race where a caller-owned
    # source changes one entry after it was visited but before the scan ends.
    first = capture_inventory_once(specifications)
    second = capture_inventory_once(specifications)
    if first != second:
        fail("mutable state changed between stable inventory passes")
    return first


def encode_manifest(specifications: Mapping[str, Spec]) -> bytes:
    value = {
        "formatVersion": 1,
        "inventory": capture_inventory(specifications),
    }
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def write_manifest(path: str, specifications: Mapping[str, Spec] = EXPECTED) -> None:
    path = canonical(path)
    payload = encode_manifest(specifications)
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
    )
    try:
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                fail("boundary manifest write did not make progress")
            offset += written
        os.fchmod(descriptor, 0o600)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    parent_descriptor = os.open(
        os.path.dirname(path),
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        os.fsync(parent_descriptor)
    finally:
        os.close(parent_descriptor)


def read_manifest(path: str, *, owner: int = 0) -> bytes:
    descriptor = open_file(canonical(path))
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or opened.st_uid != owner
            or stat.S_IMODE(opened.st_mode) != 0o600
        ):
            fail("boundary manifest ownership, mode, or link count is unsafe")
        size, _ = descriptor_digest(descriptor)
        if size > 16 * 1024 * 1024:
            fail("boundary manifest exceeds its fixed size limit")
        os.lseek(descriptor, 0, os.SEEK_SET)
        chunks: list[bytes] = []
        while chunk := os.read(descriptor, 1024 * 1024):
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def verify_manifest(
    path: str,
    specifications: Mapping[str, Spec] = EXPECTED,
    *,
    manifest_owner: int = 0,
) -> None:
    expected = encode_manifest(specifications)
    actual = read_manifest(path, owner=manifest_owner)
    if not hashlib.sha256(actual).digest() == hashlib.sha256(expected).digest():
        fail("mutable state crossed the recorded first-cutover restoration boundary")


def main() -> None:
    if os.geteuid() != 0:
        fail("helper must run as root")
    if len(sys.argv) != 3 or sys.argv[1] not in {"record", "verify"}:
        fail("usage: activation-boundary.py record|verify MANIFEST")
    if sys.argv[1] == "record":
        write_manifest(sys.argv[2])
    else:
        verify_manifest(sys.argv[2])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
