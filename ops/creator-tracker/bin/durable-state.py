#!/usr/bin/python3 -I
"""Small descriptor-pinned durability primitives for activation journals."""

from __future__ import annotations

import os
import secrets
import stat
import sys


FLAGS = os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)


def fail(message: str) -> "None":
    raise RuntimeError(f"creator-tracker durable state: {message}")


def canonical(path: str) -> str:
    if not path.startswith("/") or os.path.normpath(path) != path or path == "/":
        fail("path must be canonical, absolute, and narrower than root")
    return path


def open_parent(path: str) -> tuple[int, str]:
    path = canonical(path)
    parent, name = os.path.split(path)
    if not name or name in {".", ".."}:
        fail("target basename is unsafe")
    descriptor = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | FLAGS)
    opened = os.fstat(descriptor)
    if not stat.S_ISDIR(opened.st_mode):
        os.close(descriptor)
        fail("target parent is not a real directory")
    return descriptor, name


def write_all(descriptor: int, payload: bytes) -> None:
    offset = 0
    while offset < len(payload):
        written = os.write(descriptor, payload[offset:])
        if written <= 0:
            fail("write did not make progress")
        offset += written


def replace_payload(path: str, payload: bytes, mode: int, uid: int, gid: int) -> None:
    if len(payload) > 64 * 1024 * 1024 or mode & ~0o7777 or uid < 0 or gid < 0:
        fail("replacement attributes are invalid")
    parent, name = open_parent(path)
    temporary = f".{name}.durable.{os.getpid()}.{secrets.token_hex(8)}"
    descriptor = -1
    try:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | FLAGS,
            0o600,
            dir_fd=parent,
        )
        write_all(descriptor, payload)
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


def atomic_copy(source: str, target: str, mode: int, uid: int, gid: int) -> None:
    source_descriptor = os.open(canonical(source), os.O_RDONLY | FLAGS)
    try:
        before = os.fstat(source_descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            fail("copy source is not a single-link regular file")
        chunks: list[bytes] = []
        size = 0
        while chunk := os.read(source_descriptor, 1024 * 1024):
            size += len(chunk)
            if size > 64 * 1024 * 1024:
                fail("copy source exceeds the fixed size limit")
            chunks.append(chunk)
        after = os.fstat(source_descriptor)
        identity = lambda value: (
            value.st_dev, value.st_ino, value.st_mode, value.st_nlink,
            value.st_uid, value.st_gid, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns,
        )
        if identity(before) != identity(after) or size != before.st_size:
            fail("copy source changed while it was read")
        replace_payload(target, b"".join(chunks), mode, uid, gid)
    finally:
        os.close(source_descriptor)


def durable_unlink(path: str) -> None:
    parent, name = open_parent(path)
    try:
        try:
            os.lstat(name, dir_fd=parent)
        except FileNotFoundError:
            return
        os.unlink(name, dir_fd=parent)
        os.fsync(parent)
    finally:
        os.close(parent)


def replace_symlink(target: str, path: str, uid: int, gid: int) -> None:
    if not target or "\x00" in target or "\n" in target or uid < 0 or gid < 0:
        fail("symlink attributes are invalid")
    parent, name = open_parent(path)
    temporary = f".{name}.durable.{os.getpid()}.{secrets.token_hex(8)}"
    try:
        os.symlink(target, temporary, dir_fd=parent)
        os.chown(temporary, uid, gid, dir_fd=parent, follow_symlinks=False)
        os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
        os.fsync(parent)
    finally:
        try:
            os.unlink(temporary, dir_fd=parent)
        except FileNotFoundError:
            pass
        os.close(parent)


def fsync_tree(path: str) -> None:
    path = canonical(path)
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | FLAGS

    def walk(descriptor: int) -> None:
        before = os.fstat(descriptor)
        if not stat.S_ISDIR(before.st_mode):
            fail("fsync tree contains a non-directory root")
        for name in sorted(os.listdir(descriptor)):
            value = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            if stat.S_ISDIR(value.st_mode):
                child = os.open(name, directory_flags, dir_fd=descriptor)
                try:
                    opened = os.fstat(child)
                    if (opened.st_dev, opened.st_ino) != (value.st_dev, value.st_ino):
                        fail("directory changed while it was opened")
                    walk(child)
                finally:
                    os.close(child)
            elif stat.S_ISREG(value.st_mode):
                if value.st_nlink != 1:
                    fail("fsync tree contains a multiply-linked file")
                child = os.open(name, os.O_RDONLY | FLAGS, dir_fd=descriptor)
                try:
                    opened = os.fstat(child)
                    if (opened.st_dev, opened.st_ino) != (value.st_dev, value.st_ino):
                        fail("file changed while it was opened")
                    os.fsync(child)
                finally:
                    os.close(child)
            else:
                fail("fsync tree contains a symlink or special entry")
        os.fsync(descriptor)

    root = os.open(path, directory_flags)
    try:
        walk(root)
    finally:
        os.close(root)
    parent, _ = open_parent(path)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def main() -> None:
    if os.geteuid() != 0:
        fail("helper must run as root")
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "text" and len(sys.argv) == 7:
        path, mode, uid, gid, value = sys.argv[2:]
        if "\x00" in value or "\n" in value or "\r" in value:
            fail("text value must be one line")
        replace_payload(path, (value + "\n").encode(), int(mode, 8), int(uid), int(gid))
    elif command == "payload" and len(sys.argv) == 6:
        path, mode, uid, gid = sys.argv[2:]
        payload = sys.stdin.buffer.read(64 * 1024 + 1)
        if len(payload) > 64 * 1024:
            fail("stdin payload exceeds the fixed size limit")
        replace_payload(path, payload, int(mode, 8), int(uid), int(gid))
    elif command == "copy" and len(sys.argv) == 7:
        source, target, mode, uid, gid = sys.argv[2:]
        atomic_copy(source, target, int(mode, 8), int(uid), int(gid))
    elif command == "unlink" and len(sys.argv) == 3:
        durable_unlink(sys.argv[2])
    elif command == "symlink" and len(sys.argv) == 6:
        target, path, uid, gid = sys.argv[2:]
        replace_symlink(target, path, int(uid), int(gid))
    elif command == "fsync-tree" and len(sys.argv) == 3:
        fsync_tree(sys.argv[2])
    else:
        fail("usage: durable-state.py text|payload|copy|unlink|symlink|fsync-tree ...")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
