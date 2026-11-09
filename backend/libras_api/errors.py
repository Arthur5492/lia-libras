from __future__ import annotations

from typing import Any


class ApiError(Exception):
    """Error with a stable code. The interface changes the code into a message."""

    def __init__(self, status: int, code: str, **extra: Any):
        super().__init__(code)
        self.status = status
        self.code = code
        self.extra = extra
