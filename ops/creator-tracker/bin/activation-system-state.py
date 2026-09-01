#!/usr/bin/python3 -I
"""Snapshot, disable, and restore exact persistent systemd link state."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import stat
import sys
from pathlib import Path


UNITS = (
    "creator-tracker-dashboard-health.service",
    "creator-tracker-dashboard-health.timer",
    "creator-tracker-canonical-delivery.service",
    "creator-tracker-canonical-delivery.timer",
    "creator-tracker-instagram-discovery.service",
    "creator-tracker-instagram-discovery.timer",
    "creator-tracker-instagram-scheduler.service",
    "creator-tracker-instagram-scheduler.timer",
    "creator-tracker-provider-reconcile.service",
    "creator-tracker-provider-reconcile.timer",
    "creator-tracker-raw-verifier.service",
    "creator-tracker-raw-verifier.timer",
    "creator-tracker-roster-refresh.service",
    "creator-tracker-roster-refresh.timer",
    "creator-tracker-scheduler-tick.service",
    "creator-tracker-scheduler-tick.timer",
    "creator-tracker-worker.service",
    "creator-tracker.slice",
)
PARENT = re.compile(r"[A-Za-z0-9_.@-]+\.(?:wants|requires)\Z")
FLAGS = os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)


def fail(message: str) -> "None":
    raise RuntimeError(f"creator-tracker system state: {message}")


def canonical(path: str) -> str:
    if not path.startswith("/") or os.path.normpath(path) != path or path == "/":
        fail("path must be canonical, absolute, and narrower than root")
    return path


def file_bytes(path: str, owner: int) -> tuple[bytes, dict[str, object]]:
    descriptor = os.open(path, os.O_RDONLY | FLAGS)
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_uid != owner
            or stat.S_IMODE(before.st_mode) & 0o022
        ):
            fail(f"system unit is not a protected single-link file: {path}")
        chunks: list[bytes] = []
        size = 0
        while chunk := os.read(descriptor, 1024 * 1024):
            size += len(chunk)
            if size > 4 * 1024 * 1024:
                fail("system unit exceeds the fixed size limit")
            chunks.append(chunk)
        after = os.fstat(descriptor)
        identity = lambda value: (
            value.st_dev, value.st_ino, value.st_mode, value.st_nlink,
            value.st_uid, value.st_gid, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns,
        )
        if identity(before) != identity(after) or size != before.st_size:
            fail(f"system unit changed while it was read: {path}")
        payload = b"".join(chunks)
        return payload, {
            "type": "file",
            "device": before.st_dev,
            "inode": before.st_ino,
            "uid": before.st_uid,
            "gid": before.st_gid,
            "mode": stat.S_IMODE(before.st_mode),
            "size": size,
            "sha256": hashlib.sha256(payload).hexdigest(),
            "mtimeNs": before.st_mtime_ns,
            "ctimeNs": before.st_ctime_ns,
        }
    finally:
        os.close(descriptor)


def dependency_target(system_dir: str, parent: str, unit: str, target: str) -> bool:
    return target in {f"../{unit}", f"{system_dir}/{unit}"}


def scan(system_dir: str, owner: int) -> dict[str, object]:
    system_dir = canonical(system_dir)
    root = os.lstat(system_dir)
    if (
        not stat.S_ISDIR(root.st_mode)
        or root.st_uid != owner
        or stat.S_IMODE(root.st_mode) & 0o022
    ):
        fail("system unit directory is not protected")
    direct: dict[str, object] = {}
    for unit in UNITS:
        path = f"{system_dir}/{unit}"
        try:
            value = os.lstat(path)
        except FileNotFoundError:
            direct[unit] = {"type": "absent"}
            continue
        if stat.S_ISREG(value.st_mode):
            _, direct[unit] = file_bytes(path, owner)
        elif stat.S_ISLNK(value.st_mode):
            target = os.readlink(path)
            if value.st_uid != owner or target != "/dev/null":
                fail(f"unsupported direct unit symlink: {path}")
            direct[unit] = {"type": "symlink", "uid": value.st_uid,
                            "gid": value.st_gid, "target": target}
        else:
            fail(f"unsupported direct unit entry: {path}")

    links: dict[str, object] = {}
    for parent in sorted(os.listdir(system_dir)):
        if PARENT.fullmatch(parent) is None:
            continue
        parent_path = f"{system_dir}/{parent}"
        value = os.lstat(parent_path)
        if (
            not stat.S_ISDIR(value.st_mode)
            or value.st_uid != owner
            or stat.S_IMODE(value.st_mode) & 0o022
        ):
            fail(f"system dependency parent is unsafe: {parent_path}")
        for unit in UNITS:
            path = f"{parent_path}/{unit}"
            try:
                link = os.lstat(path)
            except FileNotFoundError:
                continue
            if not stat.S_ISLNK(link.st_mode) or link.st_uid != owner:
                fail(f"system dependency entry is not a protected symlink: {path}")
            target = os.readlink(path)
            if not dependency_target(system_dir, parent, unit, target):
                fail(f"system dependency link target is unsafe: {path}")
            links[f"{parent}/{unit}"] = {
                "uid": link.st_uid,
                "gid": link.st_gid,
                "target": target,
            }
    return {"direct": direct, "links": links}


def safe_write(path: str, payload: bytes, mode: int = 0o600) -> None:
    parent = os.path.dirname(path)
    name = os.path.basename(path)
    parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | FLAGS)
    temporary = f".{name}.{os.getpid()}.{secrets.token_hex(8)}"
    descriptor = -1
    try:
        descriptor = os.open(
            temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | FLAGS,
            mode, dir_fd=parent_fd,
        )
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                fail("system state write did not make progress")
            offset += written
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        os.fsync(parent_fd)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary, dir_fd=parent_fd)
        except FileNotFoundError:
            pass
        os.close(parent_fd)


def snapshot(system_dir: str, snapshot_dir: str, manifest: str, owner: int = 0) -> None:
    first = scan(system_dir, owner)
    os.mkdir(snapshot_dir, 0o700)
    for unit, entry in first["direct"].items():
        if entry["type"] != "file":
            continue
        payload, current = file_bytes(f"{system_dir}/{unit}", owner)
        if current != entry:
            fail("system unit changed between inventory and snapshot")
        safe_write(f"{snapshot_dir}/{unit}", payload)
    second = scan(system_dir, owner)
    if first != second:
        fail("system unit state changed between stable snapshot passes")
    safe_write(
        manifest,
        (json.dumps({"formatVersion": 1, **first}, sort_keys=True) + "\n").encode(),
    )
    directory = os.open(snapshot_dir, os.O_RDONLY | os.O_DIRECTORY | FLAGS)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def load_manifest(manifest: str, snapshot_dir: str, owner: int = 0) -> dict[str, object]:
    payload, metadata = file_bytes(manifest, owner)
    if metadata["mode"] != 0o600 or len(payload) > 1024 * 1024:
        fail("system state manifest is unsafe")
    try:
        value = json.loads(payload)
    except json.JSONDecodeError:
        fail("system state manifest is invalid")
    if (
        not isinstance(value, dict)
        or value.get("formatVersion") != 1
        or set(value) != {"formatVersion", "direct", "links"}
        or set(value["direct"]) != set(UNITS)
        or not isinstance(value["links"], dict)
    ):
        fail("system state manifest shape is invalid")
    for unit, entry in value["direct"].items():
        if not isinstance(entry, dict) or entry.get("type") not in {"absent", "file", "symlink"}:
            fail("system state manifest direct entry is invalid")
        if entry["type"] == "file":
            payload, current = file_bytes(f"{snapshot_dir}/{unit}", owner)
            if (
                len(payload) != entry.get("size")
                or hashlib.sha256(payload).hexdigest() != entry.get("sha256")
            ):
                fail("snapshotted system unit bytes changed")
        elif entry["type"] == "symlink" and entry.get("target") != "/dev/null":
            fail("snapshotted system mask is invalid")
    for relative, entry in value["links"].items():
        parent, unit = relative.split("/", 1)
        if (
            PARENT.fullmatch(parent) is None
            or unit not in UNITS
            or not isinstance(entry, dict)
            or not dependency_target("/etc/systemd/system", parent, unit, entry.get("target", ""))
        ):
            fail("snapshotted system dependency link is invalid")
    return value


def fsync_parent(path: str) -> None:
    descriptor = os.open(os.path.dirname(path), os.O_RDONLY | os.O_DIRECTORY | FLAGS)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def remove(system_dir: str, snapshot_dir: str, manifest: str, owner: int = 0) -> None:
    expected = load_manifest(manifest, snapshot_dir, owner)
    if scan(system_dir, owner) != {"direct": expected["direct"], "links": expected["links"]}:
        fail("system unit state changed after it was snapshotted")
    for relative in sorted(expected["links"], reverse=True):
        path = f"{system_dir}/{relative}"
        os.unlink(path)
        fsync_parent(path)
    for unit, entry in expected["direct"].items():
        if entry["type"] != "absent":
            path = f"{system_dir}/{unit}"
            os.unlink(path)
            fsync_parent(path)


def exact_link(path: str, entry: dict[str, object], owner: int) -> bool:
    try:
        value = os.lstat(path)
    except FileNotFoundError:
        return False
    return (
        stat.S_ISLNK(value.st_mode)
        and value.st_uid == owner
        and value.st_gid == entry["gid"]
        and os.readlink(path) == entry["target"]
    )


def logical_state(value: dict[str, object]) -> dict[str, object]:
    direct: dict[str, object] = {}
    for unit, raw_entry in value["direct"].items():
        entry = dict(raw_entry)
        for key in ("device", "inode", "mtimeNs", "ctimeNs"):
            entry.pop(key, None)
        direct[unit] = entry
    return {"direct": direct, "links": value["links"]}


def preflight_restore(system_dir: str, snapshot_dir: str, manifest: str, owner: int = 0) -> dict[str, object]:
    expected = load_manifest(manifest, snapshot_dir, owner)
    current = scan(system_dir, owner)
    for relative, entry in current["links"].items():
        if relative not in expected["links"] or entry != expected["links"][relative]:
            fail(f"unexpected system dependency link appeared: {relative}")
    for unit, entry in current["direct"].items():
        if entry["type"] == "symlink" and entry != expected["direct"][unit]:
            fail(f"unexpected system unit symlink appeared: {unit}")
    return expected


def restore(system_dir: str, snapshot_dir: str, manifest: str, owner: int = 0) -> None:
    expected = preflight_restore(system_dir, snapshot_dir, manifest, owner)
    for relative in sorted(scan(system_dir, owner)["links"], reverse=True):
        path = f"{system_dir}/{relative}"
        os.unlink(path)
        fsync_parent(path)
    for unit in UNITS:
        path = f"{system_dir}/{unit}"
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        else:
            fsync_parent(path)
        entry = expected["direct"][unit]
        if entry["type"] == "file":
            payload, _ = file_bytes(f"{snapshot_dir}/{unit}", owner)
            safe_write(path, payload, int(entry["mode"]))
        elif entry["type"] == "symlink":
            os.symlink(str(entry["target"]), path)
            os.chown(path, int(entry["uid"]), int(entry["gid"]), follow_symlinks=False)
            fsync_parent(path)
    for relative, entry in sorted(expected["links"].items()):
        path = f"{system_dir}/{relative}"
        os.symlink(str(entry["target"]), path)
        os.chown(path, int(entry["uid"]), int(entry["gid"]), follow_symlinks=False)
        fsync_parent(path)
    if logical_state(scan(system_dir, owner)) != logical_state(expected):
        fail("restored system unit state does not match its snapshot")


def main() -> None:
    if os.geteuid() != 0:
        fail("helper must run as root")
    if len(sys.argv) != 5 or sys.argv[1] not in {"snapshot", "remove", "preflight", "restore"}:
        fail("usage: activation-system-state.py snapshot|remove|preflight|restore SYSTEM_DIR SNAPSHOT_DIR MANIFEST")
    command, system_dir, snapshot_dir, manifest = sys.argv[1:]
    if system_dir != "/etc/systemd/system":
        fail("production system unit directory is not exact")
    if command == "snapshot":
        snapshot(system_dir, snapshot_dir, manifest)
    elif command == "remove":
        remove(system_dir, snapshot_dir, manifest)
    elif command == "preflight":
        preflight_restore(system_dir, snapshot_dir, manifest)
    else:
        restore(system_dir, snapshot_dir, manifest)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
