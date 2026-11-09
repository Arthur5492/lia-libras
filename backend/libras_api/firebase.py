"""Firebase Admin: Firestore client and sign-in token check."""
from __future__ import annotations

import json
import os
from functools import lru_cache

import firebase_admin
from firebase_admin import auth, credentials
from google.cloud import firestore

from .settings import get_settings


@lru_cache
def get_app() -> firebase_admin.App:
    settings = get_settings()
    options = {"projectId": settings.project_id}
    if settings.service_account_json:
        cred = credentials.Certificate(json.loads(settings.service_account_json))
        return firebase_admin.initialize_app(cred, options)
    if os.environ.get("FIRESTORE_EMULATOR_HOST") or os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"):
        return firebase_admin.initialize_app(options=options)
    raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON is not set")


@lru_cache
def get_db() -> firestore.Client:
    settings = get_settings()
    if settings.service_account_json:
        from google.oauth2 import service_account

        info = json.loads(settings.service_account_json)
        creds = service_account.Credentials.from_service_account_info(info)
        return firestore.Client(project=settings.project_id, credentials=creds)
    if os.environ.get("FIRESTORE_EMULATOR_HOST"):
        from google.auth.credentials import AnonymousCredentials

        return firestore.Client(project=settings.project_id, credentials=AnonymousCredentials())
    raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON is not set")


def verify_token(token: str) -> dict:
    return auth.verify_id_token(token, app=get_app())
