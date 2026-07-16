from __future__ import annotations

import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


class FileLockTimeoutError(TimeoutError):
    pass


_LOCAL_LOCKS: dict[str, threading.RLock] = {}
_LOCAL_LOCKS_GUARD = threading.Lock()


def _local_lock_for(path: Path) -> threading.RLock:
    key = os.path.normcase(str(path.resolve()))
    with _LOCAL_LOCKS_GUARD:
        return _LOCAL_LOCKS.setdefault(key, threading.RLock())


@contextmanager
def exclusive_file_lock(
    path: Path,
    *,
    timeout: float = 5.0,
    poll_interval: float = 0.05,
) -> Iterator[None]:
    """Serialize writers across threads and processes without extra dependencies."""

    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout
    local_lock = _local_lock_for(path)
    remaining = max(0.0, deadline - time.monotonic())
    if not local_lock.acquire(timeout=remaining):
        raise FileLockTimeoutError(f"Timed out waiting for lock: {path}")

    handle = None
    locked = False
    try:
        handle = path.open("a+b")
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()

        while True:
            try:
                _lock_handle(handle)
                locked = True
                break
            except (BlockingIOError, OSError):
                if time.monotonic() >= deadline:
                    raise FileLockTimeoutError(f"Timed out waiting for lock: {path}")
                time.sleep(min(poll_interval, max(0.0, deadline - time.monotonic())))
        yield
    finally:
        if handle is not None:
            if locked:
                _unlock_handle(handle)
            handle.close()
        local_lock.release()


def _lock_handle(handle) -> None:
    handle.seek(0)
    if os.name == "nt":
        import msvcrt

        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        return

    import fcntl

    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock_handle(handle) -> None:
    handle.seek(0)
    try:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            return

        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass
