"""Configuração lida do ambiente. Ver .env.example."""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    project_id: str
    service_account_json: str | None
    storage_mode: str
    local_bucket: Path
    hf_bucket: str
    hf_token: str | None
    target_per_sign: int
    pose_rate_min: float
    any_hand_rate_min: float
    min_reference_count: int
    page_size: int


@lru_cache
def get_settings() -> Settings:
    env = os.environ
    return Settings(
        project_id=env.get("LIA_FIREBASE_PROJECT_ID") or env.get("GCLOUD_PROJECT") or "demo-libras",
        service_account_json=env.get("FIREBASE_SERVICE_ACCOUNT_JSON"),
        storage_mode=env.get("LIA_STORAGE", "local"),
        local_bucket=Path(env.get("LIA_LOCAL_BUCKET", "local_bucket")).resolve(),
        hf_bucket=env.get("LIA_HF_BUCKET", ""),
        hf_token=env.get("HF_TOKEN"),
        target_per_sign=int(env.get("LIA_TARGET_PER_SIGN", "4")),
        pose_rate_min=float(env.get("LIA_POSE_RATE_MIN", "0.8")),
        any_hand_rate_min=float(env.get("LIA_ANY_HAND_RATE_MIN", "0.3")),
        min_reference_count=int(env.get("LIA_MIN_REFERENCE_COUNT", "3")),
        page_size=int(env.get("LIA_PAGE_SIZE", "50")),
    )
