"""Storage for `.npz` files: a local folder (for tests) or the HF bucket."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Protocol

from .settings import get_settings


class Storage(Protocol):
    def put(self, path: str, data: bytes) -> None: ...
    def get(self, path: str) -> bytes: ...
    def delete(self, path: str) -> None: ...


def _check_path(path: str) -> str:
    parts = path.split("/")
    if not path or path.startswith("/") or any(p in ("", ".", "..") or "\\" in p for p in parts):
        raise ValueError(f"Path is not valid: {path!r}")
    return path


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root

    def _file(self, path: str) -> Path:
        return self.root.joinpath(*_check_path(path).split("/"))

    def put(self, path: str, data: bytes) -> None:
        target = self._file(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def get(self, path: str) -> bytes:
        return self._file(path).read_bytes()

    def delete(self, path: str) -> None:
        self._file(path).unlink(missing_ok=True)


class HfBucketStorage:
    def __init__(self, bucket: str, token: str | None):
        from huggingface_hub import HfFileSystem

        if not bucket:
            raise RuntimeError("LIA_HF_BUCKET is not set")
        self.base = f"buckets/{bucket}"
        self.fs = HfFileSystem(token=token)

    def _remote(self, path: str) -> str:
        return f"{self.base}/{_check_path(path)}"

    def put(self, path: str, data: bytes) -> None:
        with self.fs.open(self._remote(path), "wb") as f:
            f.write(data)

    def get(self, path: str) -> bytes:
        with self.fs.open(self._remote(path), "rb") as f:
            return f.read()

    def delete(self, path: str) -> None:
        try:
            self.fs.rm(self._remote(path))
        except FileNotFoundError:
            pass


@lru_cache
def get_storage() -> Storage:
    settings = get_settings()
    if settings.storage_mode == "hf":
        return HfBucketStorage(settings.hf_bucket, settings.hf_token)
    if settings.storage_mode == "local":
        return LocalStorage(settings.local_bucket)
    raise RuntimeError(f"LIA_STORAGE is not valid: {settings.storage_mode}")
