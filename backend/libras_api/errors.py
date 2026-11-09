from __future__ import annotations

from typing import Any


class ApiError(Exception):
    """Erro com código estável; a interface traduz o código em mensagem."""

    def __init__(self, status: int, code: str, **extra: Any):
        super().__init__(code)
        self.status = status
        self.code = code
        self.extra = extra
