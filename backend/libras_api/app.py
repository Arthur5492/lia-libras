"""API routes. All writes to Firestore and to the bucket go through this module."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Body, Depends, FastAPI, Header, Query, Request, Response
from fastapi.responses import JSONResponse

from . import services as s
from .errors import ApiError
from .firebase import get_db, verify_token
from .settings import get_settings
from .storage import get_storage

logger = logging.getLogger("libras.api")
app = FastAPI(title="Libras PWA API", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

PUBLIC_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600"


@app.exception_handler(ApiError)
def _api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"code": exc.code, **exc.extra})


@dataclass
class Caller:
    uid: str
    user: dict


def current_uid(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise ApiError(401, "missing_token")
    try:
        claims = verify_token(authorization.removeprefix("Bearer ").strip())
    except Exception as exc:
        raise ApiError(401, "invalid_token") from exc
    return claims["uid"]


def current_user(uid: Annotated[str, Depends(current_uid)]) -> Caller:
    snap = get_db().collection(s.USERS).document(uid).get()
    if not snap.exists:
        raise ApiError(403, "not_registered")
    return Caller(uid, snap.to_dict())


def reviewer(caller: Annotated[Caller, Depends(current_user)]) -> Caller:
    if not s.is_reviewer(caller.user):
        raise ApiError(403, "reviewer_only")
    return caller


def admin(caller: Annotated[Caller, Depends(current_user)]) -> Caller:
    if not s.is_admin(caller.user):
        raise ApiError(403, "admin_only")
    return caller


Payload = Annotated[dict[str, Any], Body()]


# ---------- public ----------

@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "storage": get_settings().storage_mode}


@app.get("/api/signs")
def signs(response: Response) -> dict:
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return s.catalog(get_db())


@app.get("/api/stats")
def stats(response: Response) -> dict:
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return s.stats(get_db())


# ---------- profile ----------

@app.get("/api/usernames/{username}/available")
def username_available(username: str, _: Annotated[str, Depends(current_uid)]) -> dict:
    return s.username_available(get_db(), username)


@app.get("/api/me")
def me(caller: Annotated[Caller, Depends(current_user)]) -> dict:
    return s.public_profile(caller.uid, caller.user)


@app.post("/api/me", status_code=201)
def register(body: Payload, uid: Annotated[str, Depends(current_uid)]) -> dict:
    return s.register(
        get_db(),
        uid,
        str(body.get("username") or ""),
        bool(body.get("show_in_ranking", False)),
        str(body.get("consent_version") or ""),
    )


@app.patch("/api/me")
def update_me(body: Payload, caller: Annotated[Caller, Depends(current_user)]) -> dict:
    return s.update_me(get_db(), caller.uid, bool(body.get("show_in_ranking", False)))


# ---------- recordings ----------

@app.post("/api/recordings", status_code=201)
def upload(body: Payload, caller: Annotated[Caller, Depends(current_user)], response: Response) -> dict:
    result = s.upload(get_db(), get_storage(), get_settings(), caller.uid, caller.user, body)
    if result["duplicate"]:
        response.status_code = 200
    return result


@app.get("/api/me/recordings")
def my_recordings(caller: Annotated[Caller, Depends(current_user)]) -> dict:
    return {"items": s.my_recordings(get_db(), caller.user)}


@app.get("/api/recordings/{rec_id}/replay")
def replay(rec_id: str, caller: Annotated[Caller, Depends(current_user)], response: Response) -> dict:
    response.headers["Cache-Control"] = "private, max-age=300"
    return s.replay(get_db(), get_storage(), caller.user, rec_id)


@app.delete("/api/me/recordings/{rec_id}", status_code=204)
def delete_recording(rec_id: str, caller: Annotated[Caller, Depends(current_user)]) -> Response:
    s.delete_own(get_db(), get_storage(), caller.uid, caller.user, rec_id)
    return Response(status_code=204)


# ---------- review ----------

@app.get("/api/review/recordings")
def review_list(
    caller: Annotated[Caller, Depends(reviewer)],
    status: str = Query(...),
    sign_id: str | None = None,
    trust_level: str | None = None,
    flag: str | None = None,
    username: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> dict:
    params = {
        "status": status, "sign_id": sign_id, "trust_level": trust_level,
        "flag": flag, "username": username, "cursor": cursor, "limit": limit,
    }
    return s.review_list(get_db(), get_settings(), caller.user, params)


@app.patch("/api/review/recordings")
def review_batch(body: Payload, caller: Annotated[Caller, Depends(reviewer)]) -> dict:
    updates = body.get("updates")
    if not isinstance(updates, list):
        raise ApiError(422, "invalid_batch_size")
    return {"items": s.review_batch(get_db(), caller.uid, caller.user, updates)}


# ---------- administration ----------

@app.get("/api/admin/users")
def admin_users(
    _: Annotated[Caller, Depends(admin)],
    username: str | None = None,
    cursor: str | None = None,
) -> dict:
    return s.admin_users(get_db(), username, cursor, get_settings().page_size)


@app.patch("/api/admin/users/{uid}")
def admin_update_user(uid: str, body: Payload, caller: Annotated[Caller, Depends(admin)]) -> dict:
    return s.admin_update_user(get_db(), caller.uid, uid, body)


@app.get("/api/admin/signs")
def admin_signs(_: Annotated[Caller, Depends(admin)]) -> dict:
    return s.catalog(get_db(), include_inactive=True)


@app.post("/api/admin/signs", status_code=201)
def admin_create_sign(body: Payload, _: Annotated[Caller, Depends(admin)]) -> dict:
    return s.create_sign(get_db(), body)


@app.patch("/api/admin/signs/{sign_id}")
def admin_update_sign(sign_id: str, body: Payload, _: Annotated[Caller, Depends(admin)]) -> dict:
    return s.update_sign(get_db(), sign_id, body)


@app.put("/api/admin/sign-metadata-schema")
def admin_metadata_schema(body: Payload, _: Annotated[Caller, Depends(admin)]) -> dict:
    return s.update_metadata_schema(get_db(), body.get("sign_metadata_schema"))


@app.get("/api/admin/reference-profiles")
def admin_reference_profiles(_: Annotated[Caller, Depends(admin)]) -> dict:
    return s.load_profiles(get_db())


@app.post("/api/admin/reference-profiles/rebuild")
def admin_rebuild_profiles(body: Payload, _: Annotated[Caller, Depends(admin)]) -> dict:
    min_refs = int(body.get("min_references") or get_settings().min_reference_count)
    return s.rebuild_reference_profiles(get_db(), get_storage(), min_refs)
