"""Usernames, slugs e metadados de sinais."""
from __future__ import annotations

import re
import unicodedata
from typing import Any

USERNAME_DISPLAY_RE = re.compile(r"^[\w]{3,20}$")
USERNAME_KEY_RE = re.compile(r"^[a-z0-9_]{3,20}$")
RESERVED_USERNAMES = {
    "admin", "administrador", "api", "lia", "libras", "moderador", "null",
    "root", "sistema", "suporte", "undefined", "anonimo",
}
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
METADATA_KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")


class NamingError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _ascii(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")


def username_key(display: str, blocked_terms: list[str] | None = None) -> str:
    """Valida o username e devolve a chave única (minúsculas, sem acentos)."""
    display = (display or "").strip()
    if not USERNAME_DISPLAY_RE.fullmatch(display):
        raise NamingError("invalid_username")
    key = _ascii(display).lower()
    if not USERNAME_KEY_RE.fullmatch(key):
        raise NamingError("invalid_username")
    if key in RESERVED_USERNAMES:
        raise NamingError("blocked_username")
    if any(term and term in key for term in (blocked_terms or [])):
        raise NamingError("blocked_username")
    return key


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", _ascii(name).lower()).strip("-")
    slug = re.sub(r"-+", "-", slug)
    if not SLUG_RE.fullmatch(slug):
        raise NamingError("invalid_sign_name")
    return slug


def validate_metadata_schema(schema: Any) -> dict[str, dict[str, str]]:
    if not isinstance(schema, dict):
        raise NamingError("invalid_metadata_schema")
    valid = {}
    for key, field in schema.items():
        if not isinstance(key, str) or not METADATA_KEY_RE.fullmatch(key) or not isinstance(field, dict):
            raise NamingError("invalid_metadata_schema")
        if field.get("type", "boolean") != "boolean":
            raise NamingError("invalid_metadata_schema")
        label = str(field.get("label") or key.replace("_", " ").capitalize()).strip()
        valid[key] = {"type": "boolean", "label": label}
    return valid


def normalize_metadata(metadata: Any, schema: dict[str, dict[str, str]]) -> dict[str, bool]:
    if metadata is None:
        metadata = {}
    if not isinstance(metadata, dict):
        raise NamingError("invalid_sign_metadata")
    normalized = {}
    for key in schema:
        value = metadata.get(key, False)
        if not isinstance(value, bool):
            raise NamingError("invalid_sign_metadata")
        normalized[key] = value
    return normalized
