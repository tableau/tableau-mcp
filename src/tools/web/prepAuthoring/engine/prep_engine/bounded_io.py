"""Bounded local-file snapshots that reject links and check/use races."""
from __future__ import annotations

import os
import stat
import hashlib
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO, Iterator


def _is_reparse(info: os.stat_result) -> bool:
    attributes = getattr(info, "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    return stat.S_ISLNK(info.st_mode) or bool(attributes & reparse_flag)


def _same_snapshot(expected: os.stat_result, actual: os.stat_result, *, compare_change_time: bool) -> bool:
    return (
        os.path.samestat(expected, actual)
        and expected.st_size == actual.st_size
        and expected.st_mtime_ns == actual.st_mtime_ns
        and (not compare_change_time or expected.st_ctime_ns == actual.st_ctime_ns)
        and stat.S_ISREG(actual.st_mode)
    )


def read_bounded_regular_file(
    path: Path,
    maximum_bytes: int,
    *,
    limit_message: str = "file exceeds byte limit",
    unsafe_message: str = "file must be a non-linked regular file",
    changed_message: str = "file changed during bounded read",
) -> bytes:
    """Read one stable regular-file descriptor without ever retaining over the limit."""
    if maximum_bytes < 0:
        raise ValueError("maximum file size must not be negative")
    expected = os.lstat(path)
    if _is_reparse(expected) or not stat.S_ISREG(expected.st_mode):
        raise ValueError(unsafe_message)
    if expected.st_size > maximum_bytes:
        raise ValueError(limit_message)
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ValueError(unsafe_message) from exc
    try:
        before = os.fstat(descriptor)
        if not _same_snapshot(expected, before, compare_change_time=False):
            raise ValueError(changed_message)
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            payload = stream.read(maximum_bytes + 1)
        after = os.fstat(descriptor)
        if not _same_snapshot(before, after, compare_change_time=True) or len(payload) != expected.st_size:
            raise ValueError(changed_message)
        if len(payload) > maximum_bytes:
            raise ValueError(limit_message)
        return payload
    finally:
        os.close(descriptor)


@contextmanager
def open_bounded_regular_file(
    path: Path,
    maximum_bytes: int,
    *,
    limit_message: str = "file exceeds byte limit",
    unsafe_message: str = "file must be a non-linked regular file",
    changed_message: str = "file changed while it was open",
) -> Iterator[BinaryIO]:
    """Open one stable regular-file descriptor for bounded streaming or seeking."""
    if maximum_bytes < 0:
        raise ValueError("maximum file size must not be negative")
    expected = os.lstat(path)
    if _is_reparse(expected) or not stat.S_ISREG(expected.st_mode):
        raise ValueError(unsafe_message)
    if expected.st_size > maximum_bytes:
        raise ValueError(limit_message)
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ValueError(unsafe_message) from exc
    try:
        before = os.fstat(descriptor)
        if not _same_snapshot(expected, before, compare_change_time=False):
            raise ValueError(changed_message)
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            try:
                yield stream
            except BaseException:
                raise
            else:
                after = os.fstat(descriptor)
                if not _same_snapshot(before, after, compare_change_time=True):
                    raise ValueError(changed_message)
    finally:
        os.close(descriptor)


def hash_bounded_regular_file(
    path: Path,
    maximum_bytes: int,
    *,
    limit_message: str = "file exceeds byte limit",
    unsafe_message: str = "file must be a non-linked regular file",
    changed_message: str = "file changed while it was hashed",
) -> str:
    """Hash one stable regular-file descriptor with fixed memory usage."""
    digest = hashlib.sha256()
    total = 0
    with open_bounded_regular_file(
        path,
        maximum_bytes,
        limit_message=limit_message,
        unsafe_message=unsafe_message,
        changed_message=changed_message,
    ) as stream:
        expected_size = os.fstat(stream.fileno()).st_size
        while chunk := stream.read(1024 * 1024):
            total += len(chunk)
            if total > maximum_bytes:
                raise ValueError(limit_message)
            digest.update(chunk)
        if total != expected_size:
            raise ValueError(changed_message)
    return digest.hexdigest()
