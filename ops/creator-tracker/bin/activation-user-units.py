#!/usr/bin/python3 -I
"""Quarantine fixed legacy user units without moving caller-owned inodes."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import stat
import sys


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
    raise RuntimeError(f"creator-tracker legacy user units: {message}")


def canonical(path: str) -> str:
    if not path.startswith("/") or os.path.normpath(path) != path or path == "/":
        fail("path must be canonical, absolute, and narrower than root")
    return path


def read_file(path: str, owner: int) -> tuple[bytes, dict[str, object]]:
    descriptor = os.open(path, os.O_RDONLY | FLAGS)
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_uid != owner
            or stat.S_IMODE(before.st_mode) & 0o022
        ):
            fail(f"legacy unit is not a protected single-link file: {path}")
        chunks: list[bytes] = []
        size = 0
        while chunk := os.read(descriptor, 1024 * 1024):
            size += len(chunk)
            if size > 4 * 1024 * 1024:
                fail("legacy unit exceeds the fixed size limit")
            chunks.append(chunk)
        after = os.fstat(descriptor)
        identity = lambda value: (
            value.st_dev, value.st_ino, value.st_mode, value.st_nlink,
            value.st_uid, value.st_gid, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns,
        )
        if identity(before) != identity(after) or size != before.st_size:
            fail(f"legacy unit changed while it was read: {path}")
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


def valid_dependency_target(user_dir: str, unit: str, target: str) -> bool:
    return target in {f"../{unit}", f"{user_dir}/{unit}"}


def scan(user_dir: str, owner: int) -> dict[str, object]:
    user_dir = canonical(user_dir)
    root = os.lstat(user_dir)
    if (
        not stat.S_ISDIR(root.st_mode)
        or root.st_uid != owner
        or stat.S_IMODE(root.st_mode) & 0o022
    ):
        fail("legacy user unit root is not owner-controlled")
    direct: dict[str, object] = {}
    for unit in UNITS:
        for suffix in (".d", ".wants", ".requires"):
            unsupported = f"{user_dir}/{unit}{suffix}"
            try:
                os.lstat(unsupported)
            except FileNotFoundError:
                pass
            else:
                fail(f"legacy unit extension directory must be removed before cutover: {unsupported}")
        path = f"{user_dir}/{unit}"
        try:
            value = os.lstat(path)
        except FileNotFoundError:
            direct[unit] = {"type": "absent"}
            continue
        if not stat.S_ISREG(value.st_mode):
            fail(f"legacy direct unit is not a regular file: {path}")
        _, direct[unit] = read_file(path, owner)

    links: dict[str, object] = {}
    for parent in sorted(os.listdir(user_dir)):
        if PARENT.fullmatch(parent) is None:
            continue
        parent_path = f"{user_dir}/{parent}"
        value = os.lstat(parent_path)
        if (
            not stat.S_ISDIR(value.st_mode)
            or value.st_uid != owner
            or stat.S_IMODE(value.st_mode) & 0o022
        ):
            fail(f"legacy dependency parent is unsafe: {parent_path}")
        for unit in UNITS:
            path = f"{parent_path}/{unit}"
            try:
                link = os.lstat(path)
            except FileNotFoundError:
                continue
            if not stat.S_ISLNK(link.st_mode) or link.st_uid != owner:
                fail(f"legacy dependency entry is not an owner symlink: {path}")
            target = os.readlink(path)
            if not valid_dependency_target(user_dir, unit, target):
                fail(f"legacy dependency target is unsafe: {path}")
            links[f"{parent}/{unit}"] = {
                "uid": link.st_uid,
                "gid": link.st_gid,
                "target": target,
            }
    return {"direct": direct, "links": links}


def write_file(path: str, payload: bytes, mode: int, uid: int, gid: int) -> None:
    parent_path, name = os.path.split(canonical(path))
    parent = os.open(parent_path, os.O_RDONLY | os.O_DIRECTORY | FLAGS)
    temporary = f".{name}.{os.getpid()}.{secrets.token_hex(8)}"
    descriptor = -1
    try:
        descriptor = os.open(
            temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | FLAGS,
            0o600, dir_fd=parent,
        )
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                fail("legacy snapshot write did not make progress")
            offset += written
        os.fchown(descriptor, uid, gid)
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
        os.fsync(parent)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary, dir_fd=parent)
        except FileNotFoundError:
            pass
        os.close(parent)


def fsync_parent(path: str) -> None:
    descriptor = os.open(os.path.dirname(path), os.O_RDONLY | os.O_DIRECTORY | FLAGS)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def snapshot(user_dir: str, snapshot_dir: str, manifest: str, owner: int) -> None:
    first = scan(user_dir, owner)
    os.mkdir(snapshot_dir, 0o700)
    snapshot_owner = os.geteuid()
    snapshot_group = os.getegid()
    for unit, entry in first["direct"].items():
        if entry["type"] != "file":
            continue
        payload, current = read_file(f"{user_dir}/{unit}", owner)
        if current != entry:
            fail("legacy unit changed between inventory and snapshot")
        write_file(
            f"{snapshot_dir}/{unit}", payload, 0o600,
            snapshot_owner, snapshot_group,
        )
    if scan(user_dir, owner) != first:
        fail("legacy unit state changed between stable snapshot passes")
    write_file(
        manifest,
        (json.dumps({"formatVersion": 1, **first}, sort_keys=True) + "\n").encode(),
        0o600, snapshot_owner, snapshot_group,
    )
    descriptor = os.open(snapshot_dir, os.O_RDONLY | os.O_DIRECTORY | FLAGS)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def load(manifest: str, snapshot_dir: str, owner: int = 0) -> dict[str, object]:
    payload, metadata = read_file(manifest, owner)
    if metadata["mode"] != 0o600:
        fail("legacy unit manifest is not private")
    try:
        value = json.loads(payload)
    except json.JSONDecodeError:
        fail("legacy unit manifest is invalid")
    if (
        not isinstance(value, dict)
        or value.get("formatVersion") != 1
        or set(value) != {"formatVersion", "direct", "links"}
        or set(value["direct"]) != set(UNITS)
        or not isinstance(value["links"], dict)
    ):
        fail("legacy unit manifest shape is invalid")
    for unit, entry in value["direct"].items():
        if not isinstance(entry, dict) or entry.get("type") not in {"absent", "file"}:
            fail("legacy direct unit manifest entry is invalid")
        if entry["type"] == "file":
            saved, saved_metadata = read_file(f"{snapshot_dir}/{unit}", owner)
            if (
                saved_metadata["mode"] != 0o600
                or len(saved) != entry.get("size")
                or hashlib.sha256(saved).hexdigest() != entry.get("sha256")
            ):
                fail("legacy unit snapshot bytes changed")
    for relative, entry in value["links"].items():
        parent, unit = relative.split("/", 1)
        if (
            PARENT.fullmatch(parent) is None
            or unit not in UNITS
            or not isinstance(entry, dict)
            or not valid_dependency_target(
                "/home/ark296/.config/systemd/user", unit, entry.get("target", "")
            )
        ):
            fail("legacy dependency manifest entry is invalid")
    return value


def remove(user_dir: str, snapshot_dir: str, manifest: str, owner: int) -> None:
    expected = load(manifest, snapshot_dir, os.geteuid())
    if scan(user_dir, owner) != {"direct": expected["direct"], "links": expected["links"]}:
        fail("legacy unit state changed after its snapshot")
    for relative in sorted(expected["links"], reverse=True):
        path = f"{user_dir}/{relative}"
        os.unlink(path)
        fsync_parent(path)
    for unit, entry in expected["direct"].items():
        if entry["type"] == "file":
            path = f"{user_dir}/{unit}"
            os.unlink(path)
            fsync_parent(path)


def logical_direct(entry: dict[str, object]) -> dict[str, object]:
    result = dict(entry)
    for key in ("device", "inode", "mtimeNs", "ctimeNs"):
        result.pop(key, None)
    return result


def current_matches_expected(user_dir: str, snapshot_dir: str, expected: dict[str, object], owner: int) -> bool:
    current = scan(user_dir, owner)
    for unit, entry in current["direct"].items():
        wanted = expected["direct"][unit]
        if entry["type"] == "file":
            if wanted["type"] != "file" or logical_direct(entry) != logical_direct(wanted):
                return False
    for relative, entry in current["links"].items():
        if relative not in expected["links"] or entry != expected["links"][relative]:
            return False
    return True


def restored_matches_expected(user_dir: str, expected: dict[str, object], owner: int) -> bool:
    current = scan(user_dir, owner)
    if current["links"] != expected["links"]:
        return False
    return all(
        logical_direct(current["direct"][unit]) == logical_direct(wanted)
        for unit, wanted in expected["direct"].items()
    )


def preflight(user_dir: str, snapshot_dir: str, manifest: str, owner: int) -> dict[str, object]:
    expected = load(manifest, snapshot_dir, os.geteuid())
    if not current_matches_expected(user_dir, snapshot_dir, expected, owner):
        fail("legacy unit restoration destination has a conflicting entry")
    return expected


def restore(user_dir: str, snapshot_dir: str, manifest: str, owner: int) -> None:
    expected = preflight(user_dir, snapshot_dir, manifest, owner)
    current = scan(user_dir, owner)
    for unit, wanted in expected["direct"].items():
        if wanted["type"] != "file" or current["direct"][unit]["type"] == "file":
            continue
        payload, _ = read_file(f"{snapshot_dir}/{unit}", os.geteuid())
        write_file(
            f"{user_dir}/{unit}", payload, int(wanted["mode"]),
            int(wanted["uid"]), int(wanted["gid"]),
        )
    for relative, wanted in sorted(expected["links"].items()):
        path = f"{user_dir}/{relative}"
        try:
            os.lstat(path)
        except FileNotFoundError:
            parent, name = os.path.split(path)
            descriptor = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | FLAGS)
            temporary = f".{name}.{os.getpid()}.{secrets.token_hex(8)}"
            try:
                os.symlink(str(wanted["target"]), temporary, dir_fd=descriptor)
                os.chown(
                    temporary, int(wanted["uid"]), int(wanted["gid"]),
                    dir_fd=descriptor, follow_symlinks=False,
                )
                os.replace(temporary, name, src_dir_fd=descriptor, dst_dir_fd=descriptor)
                os.fsync(descriptor)
            finally:
                try:
                    os.unlink(temporary, dir_fd=descriptor)
                except FileNotFoundError:
                    pass
                os.close(descriptor)
    if not restored_matches_expected(user_dir, expected, owner):
        fail("restored legacy unit state does not match its root snapshot")


def main() -> None:
    if os.geteuid() != 0:
        fail("helper must run as root")
    if len(sys.argv) != 7 or sys.argv[1] not in {"snapshot", "remove", "preflight", "restore"}:
        fail("usage: activation-user-units.py snapshot|remove|preflight|restore USER_DIR SNAPSHOT_DIR MANIFEST UID GID")
    command, user_dir, snapshot_dir, manifest, owner, _group = sys.argv[1:]
    if (
        user_dir != "/home/ark296/.config/systemd/user"
        or int(owner) != 1000
        or int(_group) != 1000
    ):
        fail("production legacy user identity or path is not exact")
    if command == "snapshot":
        snapshot(user_dir, snapshot_dir, manifest, int(owner))
    elif command == "remove":
        remove(user_dir, snapshot_dir, manifest, int(owner))
    elif command == "preflight":
        preflight(user_dir, snapshot_dir, manifest, int(owner))
    else:
        restore(user_dir, snapshot_dir, manifest, int(owner))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
