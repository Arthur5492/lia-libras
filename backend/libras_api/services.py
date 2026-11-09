"""Operações sobre Firestore e bucket. Esquema em contract/firestore.md."""
from __future__ import annotations

import time
import uuid as uuid_lib
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from google.api_core.exceptions import AlreadyExists, Conflict
from google.cloud import firestore
from google.cloud.firestore import FieldFilter

from . import metrics as m
from .errors import ApiError
from .naming import NamingError, normalize_metadata, slugify, username_key, validate_metadata_schema
from .recording import PayloadError, parse_upload, read_npz, replay_payload, to_npz_bytes
from .settings import Settings
from .storage import Storage

USERS, USERNAMES, LEGACY, SIGNS, RECORDINGS, CONFIG = (
    "users", "usernames", "legacy_users", "signs", "recordings", "config",
)
TRUST_LEVELS = ("regular", "trusted", "expert")
REVIEWER_LEVELS = {"trusted", "expert"}
PENDING = {"unreviewed", "trusted_unreviewed"}
LISTABLE_STATUSES = ("unreviewed", "trusted_unreviewed", "accepted", "rejected")
HIDDEN_STATUSES = {"deleted", "uploading"}
STALE_UPLOAD = timedelta(minutes=2)
MAX_REVIEW_BATCH = 50
PROFILES_CACHE_SECONDS = 60

_profiles_cache: dict[str, Any] = {"ts": 0.0, "value": None}


def clear_caches() -> None:
    _profiles_cache.update(ts=0.0, value=None)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


def default_status(trust_level: str) -> str:
    return "trusted_unreviewed" if trust_level in REVIEWER_LEVELS else "unreviewed"


def counts_as_reference(status: str, trust_level: str) -> bool:
    return status == "accepted" and trust_level == "expert"


def is_reviewer(user: dict) -> bool:
    return user.get("role") == "admin" or user.get("trust_level") in REVIEWER_LEVELS


def is_admin(user: dict) -> bool:
    return user.get("role") == "admin"


# ---------- perfil ----------

def public_profile(uid: str, data: dict) -> dict:
    return {
        "uid": uid,
        "uuid": data.get("uuid"),
        "username": data.get("username"),
        "role": data.get("role", "user"),
        "trust_level": data.get("trust_level", "regular"),
        "show_in_ranking": bool(data.get("show_in_ranking")),
        "consent_version": data.get("consent_version"),
        "recording_count": int(data.get("recording_count") or 0),
        "sign_recordings": data.get("sign_recordings") or {},
        "created_at": _iso(data.get("created_at")),
    }


def _blocked_terms(db: firestore.Client) -> list[str]:
    snap = db.collection(CONFIG).document("username_blocklist").get()
    return [str(t).lower() for t in (snap.get("terms") or [])] if snap.exists else []


def _username_key(db: firestore.Client, username: str) -> str:
    try:
        return username_key(username, _blocked_terms(db))
    except NamingError as exc:
        raise ApiError(422, exc.code) from exc


def username_available(db: firestore.Client, username: str) -> dict:
    key = _username_key(db, username)
    taken = db.collection(USERNAMES).document(key).get().exists
    return {"username_key": key, "available": not taken}


def register(db: firestore.Client, uid: str, username: str, show_in_ranking: bool, consent_version: str) -> dict:
    if not consent_version:
        raise ApiError(422, "consent_required")
    key = _username_key(db, username)
    user_ref = db.collection(USERS).document(uid)
    name_ref = db.collection(USERNAMES).document(key)

    @firestore.transactional
    def tx(t):
        if user_ref.get(transaction=t).exists:
            raise ApiError(409, "already_registered")
        if name_ref.get(transaction=t).exists:
            raise ApiError(409, "username_taken")
        t.create(name_ref, {"uid": uid, "created_at": firestore.SERVER_TIMESTAMP})
        t.create(user_ref, {
            "uuid": str(uuid_lib.uuid4()),
            "username": username.strip(),
            "username_key": key,
            "role": "user",
            "trust_level": "regular",
            "show_in_ranking": bool(show_in_ranking),
            "consent_version": consent_version,
            "consent_at": firestore.SERVER_TIMESTAMP,
            "recording_count": 0,
            "sign_recordings": {},
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })

    try:
        tx(db.transaction())
    except (AlreadyExists, Conflict) as exc:
        # Outra transação criou o mesmo username ou perfil ao mesmo tempo.
        code = "already_registered" if user_ref.get().exists else "username_taken"
        raise ApiError(409, code) from exc
    return public_profile(uid, user_ref.get().to_dict())


def update_me(db: firestore.Client, uid: str, show_in_ranking: bool) -> dict:
    ref = db.collection(USERS).document(uid)
    ref.update({"show_in_ranking": bool(show_in_ranking), "updated_at": firestore.SERVER_TIMESTAMP})
    return public_profile(uid, ref.get().to_dict())


# ---------- catálogo e estatísticas ----------

def _catalog_config(db: firestore.Client) -> dict:
    snap = db.collection(CONFIG).document("sign_catalog").get()
    data = snap.to_dict() if snap.exists else {}
    return {
        "schema_version": data.get("schema_version", "1.0"),
        "sign_metadata_schema": data.get("sign_metadata_schema", {}),
    }


def public_sign(sign_id: str, data: dict) -> dict:
    return {
        "id": sign_id,
        "slug": data.get("slug"),
        "name": data.get("name"),
        "video_url": data.get("video_url"),
        "sign_metadata": data.get("metadata") or {},
        "active": bool(data.get("active", True)),
        "order": int(data.get("order") or 0),
        "recording_count": int(data.get("recording_count") or 0),
        "accepted_count": int(data.get("accepted_count") or 0),
        "reference_count": int(data.get("reference_count") or 0),
    }


def catalog(db: firestore.Client, include_inactive: bool = False) -> dict:
    signs = [public_sign(s.id, s.to_dict()) for s in db.collection(SIGNS).stream()]
    if not include_inactive:
        signs = [s for s in signs if s["active"]]
    signs.sort(key=lambda s: (s["order"], (s["name"] or "").lower()))
    return {**_catalog_config(db), "signs": signs}


def stats(db: firestore.Client, ranking_size: int = 20) -> dict:
    signs = [s.to_dict() for s in db.collection(SIGNS).stream()]
    query = (
        db.collection(USERS)
        .where(filter=FieldFilter("show_in_ranking", "==", True))
        .order_by("recording_count", direction=firestore.Query.DESCENDING)
        .limit(ranking_size)
    )
    ranking = [
        {"username": d.get("username"), "recording_count": int(d.get("recording_count") or 0)}
        for d in (snap.to_dict() for snap in query.stream())
        if int(d.get("recording_count") or 0) > 0
    ]
    return {
        "total_recordings": sum(int(s.get("recording_count") or 0) for s in signs),
        "accepted_recordings": sum(int(s.get("accepted_count") or 0) for s in signs),
        "ranking": ranking,
    }


# ---------- gravações ----------

def public_recording(rec_id: str, data: dict) -> dict:
    return {
        "id": rec_id,
        "uuid": data.get("uuid"),
        "sign_id": data.get("sign_id"),
        "sign_slug": data.get("sign_slug"),
        "video_idx": data.get("video_idx"),
        "status": data.get("status"),
        "schema_version": data.get("schema_version"),
        "pose_rate": data.get("pose_rate"),
        "left_hand_rate": data.get("left_hand_rate"),
        "right_hand_rate": data.get("right_hand_rate"),
        "any_hand_rate": data.get("any_hand_rate"),
        "both_hands_rate": data.get("both_hands_rate"),
        "motion_score": data.get("motion_score"),
        "active_hand": data.get("active_hand"),
        "validation_flags": data.get("validation_flags") or [],
        "reference_similarity_score": data.get("reference_similarity_score"),
        "user_trust_level": data.get("user_trust_level"),
        "counts_as_reference": bool(data.get("counts_as_reference")),
        "reviewed_at": _iso(data.get("reviewed_at")),
        "created_at": _iso(data.get("created_at")),
    }


def load_profiles(db: firestore.Client) -> dict:
    now = time.monotonic()
    if _profiles_cache["value"] is not None and now - _profiles_cache["ts"] < PROFILES_CACHE_SECONDS:
        return _profiles_cache["value"]
    snap = db.collection(CONFIG).document("reference_profiles").get()
    value = snap.to_dict() if snap.exists else {"profiles": {}}
    _profiles_cache.update(ts=now, value=value)
    return value


def _active_sign(db: firestore.Client, sign_id: str) -> dict:
    if not isinstance(sign_id, str) or not sign_id:
        raise ApiError(422, "unknown_sign")
    snap = db.collection(SIGNS).document(sign_id).get()
    if not snap.exists or not snap.get("active"):
        raise ApiError(422, "unknown_sign")
    return snap.to_dict()


def upload(db: firestore.Client, storage: Storage, settings: Settings, uid: str, user: dict, body: dict) -> dict:
    client_id = str(body.get("client_id") or "")
    try:
        uuid_lib.UUID(client_id)
    except ValueError as exc:
        raise ApiError(422, "invalid_client_id") from exc
    sign_id = body.get("sign_id")
    sign = _active_sign(db, sign_id)
    try:
        data = parse_upload(body)
    except PayloadError as exc:
        raise ApiError(422, exc.code) from exc

    rates = m.recording_metrics(data)
    failures = m.basic_flags(rates, settings.pose_rate_min, settings.any_hand_rate_min)
    if failures:
        raise ApiError(422, "low_quality", validation_flags=failures, metrics=rates)
    assessment = m.assess_reference(rates, load_profiles(db), sign_id)

    person = user["uuid"]
    trust = user.get("trust_level", "regular")
    capture_version = str(body.get("capture_version") or "")[:40]
    user_ref = db.collection(USERS).document(uid)
    base = {
        "uuid": person,
        "sign_id": sign_id,
        "sign_slug": sign["slug"],
        "schema_version": "1.1",
        "capture_version": capture_version,
        "client_id": client_id,
        **{k: round(float(v), 4) for k, v in rates.items()},
        "active_hand": data["active_hand"],
        "validation_flags": assessment["validation_flags"],
        "reference_similarity_score": assessment["reference_similarity_score"],
        "user_trust_level": trust,
        "counts_as_reference": False,
        "reviewed_by": None,
        "reviewed_at": None,
    }

    @firestore.transactional
    def reserve(t):
        dup = list(
            db.collection(RECORDINGS).where(filter=FieldFilter("client_id", "==", client_id)).limit(1).get(transaction=t)
        )
        if dup:
            found = dup[0].to_dict()
            if found.get("uuid") != person:
                raise ApiError(409, "client_id_conflict")
            if found.get("status") != "uploading":
                return "done", dup[0].id, found
            if _now() - found["reserved_at"] < STALE_UPLOAD:
                raise ApiError(409, "upload_in_progress")
            t.update(dup[0].reference, {"reserved_at": _now()})
            return "reserved", dup[0].id, found["video_idx"]

        user_snap = user_ref.get(transaction=t)
        sign_recordings = dict(user_snap.get("sign_recordings") or {})
        used = set(sign_recordings.get(sign_id, []))
        chosen = None
        for idx in range(1, settings.target_per_sign + 1):
            if idx in used:
                continue
            ref = db.collection(RECORDINGS).document(f"{person}_{sign_id}_{idx:02d}")
            snap = ref.get(transaction=t)
            if not snap.exists or snap.get("status") == "deleted":
                chosen = (idx, ref)
                break
        if chosen is None:
            raise ApiError(409, "sign_complete")
        idx, ref = chosen
        sign_recordings[sign_id] = sorted(used | {idx})
        t.update(user_ref, {"sign_recordings": sign_recordings, "updated_at": firestore.SERVER_TIMESTAMP})
        t.set(ref, {
            **base,
            "video_idx": idx,
            "path": f"{sign['slug']}/{person}/{idx:02d}.npz",
            "status": "uploading",
            "reserved_at": _now(),
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        return "reserved", ref.id, idx

    state, rec_id, value = reserve(db.transaction())
    rec_ref = db.collection(RECORDINGS).document(rec_id)
    if state == "done":
        return {"recording": public_recording(rec_id, value), "replay": None, "duplicate": True}

    idx = value
    path = f"{sign['slug']}/{person}/{idx:02d}.npz"
    try:
        storage.put(path, to_npz_bytes(data, sign_id, idx, capture_version))
    except Exception as exc:
        _release(db, rec_ref, user_ref, sign_id, idx)
        raise ApiError(502, "storage_error") from exc

    sign_ref = db.collection(SIGNS).document(sign_id)

    @firestore.transactional
    def finalize(t):
        snap = rec_ref.get(transaction=t)
        if snap.get("status") != "uploading":
            return
        t.update(rec_ref, {"status": default_status(trust), "updated_at": firestore.SERVER_TIMESTAMP})
        t.update(user_ref, {"recording_count": firestore.Increment(1)})
        t.update(sign_ref, {"recording_count": firestore.Increment(1)})

    finalize(db.transaction())
    replay = replay_payload({**data, "target_fps": 15.0})
    return {"recording": public_recording(rec_id, rec_ref.get().to_dict()), "replay": replay, "duplicate": False}


def _release(db: firestore.Client, rec_ref, user_ref, sign_id: str, idx: int) -> None:
    @firestore.transactional
    def tx(t):
        rec = rec_ref.get(transaction=t)
        user = user_ref.get(transaction=t)
        if rec.exists and rec.get("status") == "uploading":
            t.delete(rec_ref)
        sign_recordings = dict(user.get("sign_recordings") or {})
        sign_recordings[sign_id] = [i for i in sign_recordings.get(sign_id, []) if i != idx]
        t.update(user_ref, {"sign_recordings": sign_recordings})

    tx(db.transaction())


def _visible_recording(db: firestore.Client, rec_id: str) -> tuple[Any, dict]:
    ref = db.collection(RECORDINGS).document(rec_id)
    snap = ref.get()
    if not snap.exists or snap.get("status") in HIDDEN_STATUSES:
        raise ApiError(404, "recording_not_found")
    return ref, snap.to_dict()


def my_recordings(db: firestore.Client, user: dict) -> list[dict]:
    query = (
        db.collection(RECORDINGS)
        .where(filter=FieldFilter("uuid", "==", user["uuid"]))
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .limit(500)
    )
    return [
        public_recording(s.id, s.to_dict())
        for s in query.stream()
        if s.get("status") not in HIDDEN_STATUSES
    ]


def replay(db: firestore.Client, storage: Storage, user: dict, rec_id: str) -> dict:
    _, data = _visible_recording(db, rec_id)
    if data["uuid"] != user["uuid"] and not is_reviewer(user):
        raise ApiError(404, "recording_not_found")
    try:
        npz = read_npz(storage.get(data["path"]))
    except FileNotFoundError as exc:
        raise ApiError(404, "recording_file_missing") from exc
    return {"recording": public_recording(rec_id, data), **replay_payload(npz)}


def delete_own(db: firestore.Client, storage: Storage, uid: str, user: dict, rec_id: str) -> None:
    _, data = _visible_recording(db, rec_id)
    if data["uuid"] != user["uuid"]:
        raise ApiError(404, "recording_not_found")
    storage.delete(data["path"])
    rec_ref = db.collection(RECORDINGS).document(rec_id)
    user_ref = db.collection(USERS).document(uid)
    sign_ref = db.collection(SIGNS).document(data["sign_id"])

    @firestore.transactional
    def tx(t):
        rec = rec_ref.get(transaction=t)
        owner = user_ref.get(transaction=t)
        if not rec.exists or rec.get("status") in HIDDEN_STATUSES:
            return
        current = rec.to_dict()
        sign_recordings = dict(owner.get("sign_recordings") or {})
        sign_recordings[current["sign_id"]] = [
            i for i in sign_recordings.get(current["sign_id"], []) if i != current["video_idx"]
        ]
        t.update(rec_ref, {
            "status": "deleted",
            "counts_as_reference": False,
            "deleted_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        t.update(user_ref, {"sign_recordings": sign_recordings, "recording_count": firestore.Increment(-1)})
        t.update(sign_ref, {
            "recording_count": firestore.Increment(-1),
            "accepted_count": firestore.Increment(-int(current["status"] == "accepted")),
            "reference_count": firestore.Increment(-int(bool(current.get("counts_as_reference")))),
        })

    tx(db.transaction())


# ---------- análise ----------

def _uuid_for_username(db: firestore.Client, username: str) -> str | None:
    try:
        key = username_key(username)
    except NamingError:
        return None
    snap = db.collection(USERNAMES).document(key).get()
    if not snap.exists:
        return None
    if snap.get("uid"):
        owner = db.collection(USERS).document(snap.get("uid")).get()
        return owner.get("uuid") if owner.exists else None
    return snap.to_dict().get("legacy_uuid")


def review_list(db: firestore.Client, settings: Settings, user: dict, params: dict) -> dict:
    status = params.get("status")
    if status not in LISTABLE_STATUSES:
        raise ApiError(422, "invalid_status")
    extra = {k: v for k, v in params.items() if k in ("sign_id", "trust_level", "flag", "username") and v}
    if len(extra) > 1:
        raise ApiError(422, "too_many_filters")
    query = db.collection(RECORDINGS).where(filter=FieldFilter("status", "==", status))
    if "sign_id" in extra:
        query = query.where(filter=FieldFilter("sign_id", "==", extra["sign_id"]))
    elif "trust_level" in extra:
        query = query.where(filter=FieldFilter("user_trust_level", "==", extra["trust_level"]))
    elif "flag" in extra:
        query = query.where(filter=FieldFilter("validation_flags", "array_contains", extra["flag"]))
    elif "username" in extra:
        person = _uuid_for_username(db, extra["username"])
        if person is None:
            return {"items": [], "next_cursor": None}
        query = query.where(filter=FieldFilter("uuid", "==", person))
    query = query.order_by("created_at", direction=firestore.Query.DESCENDING)
    if params.get("cursor"):
        cursor = db.collection(RECORDINGS).document(params["cursor"]).get()
        if not cursor.exists:
            raise ApiError(422, "invalid_cursor")
        query = query.start_after(cursor)
    limit = min(int(params.get("limit") or settings.page_size), settings.page_size)
    snaps = list(query.limit(limit).stream())
    items = [{**public_recording(s.id, s.to_dict()), "is_own": s.get("uuid") == user["uuid"]} for s in snaps]
    return {"items": items, "next_cursor": snaps[-1].id if len(snaps) == limit else None}


def review_batch(db: firestore.Client, uid: str, user: dict, updates: list[dict]) -> list[dict]:
    if not updates or len(updates) > MAX_REVIEW_BATCH:
        raise ApiError(422, "invalid_batch_size")
    wanted = {}
    for item in updates:
        if item.get("status") not in ("accepted", "rejected", "pending"):
            raise ApiError(422, "invalid_status")
        wanted[str(item.get("id"))] = item["status"]
    refs = {rec_id: db.collection(RECORDINGS).document(rec_id) for rec_id in wanted}

    @firestore.transactional
    def tx(t):
        snaps = {rec_id: ref.get(transaction=t) for rec_id, ref in refs.items()}
        deltas: dict[str, dict[str, int]] = defaultdict(lambda: {"accepted_count": 0, "reference_count": 0})
        writes = []
        for rec_id, snap in snaps.items():
            if not snap.exists or snap.get("status") in HIDDEN_STATUSES:
                raise ApiError(404, "recording_not_found", id=rec_id)
            current = snap.to_dict()
            if current["uuid"] == user["uuid"]:
                raise ApiError(403, "cannot_review_own", id=rec_id)
            trust = current.get("user_trust_level", "regular")
            new_status = default_status(trust) if wanted[rec_id] == "pending" else wanted[rec_id]
            new_ref = counts_as_reference(new_status, trust)
            delta = deltas[current["sign_id"]]
            delta["accepted_count"] += int(new_status == "accepted") - int(current["status"] == "accepted")
            delta["reference_count"] += int(new_ref) - int(bool(current.get("counts_as_reference")))
            reviewed = wanted[rec_id] != "pending"
            writes.append((refs[rec_id], {
                "status": new_status,
                "counts_as_reference": new_ref,
                "reviewed_by": uid if reviewed else None,
                "reviewed_at": firestore.SERVER_TIMESTAMP if reviewed else None,
                "updated_at": firestore.SERVER_TIMESTAMP,
            }))
        for ref, fields in writes:
            t.update(ref, fields)
        for sign_id, delta in deltas.items():
            if any(delta.values()):
                t.update(db.collection(SIGNS).document(sign_id), {k: firestore.Increment(v) for k, v in delta.items()})

    tx(db.transaction())
    return [public_recording(rec_id, ref.get().to_dict()) for rec_id, ref in refs.items()]


# ---------- administração ----------

def admin_users(db: firestore.Client, username: str | None, cursor: str | None, page_size: int) -> dict:
    if username:
        try:
            key = username_key(username)
        except NamingError:
            return {"items": [], "next_cursor": None}
        name = db.collection(USERNAMES).document(key).get()
        if not name.exists or not name.get("uid"):
            return {"items": [], "next_cursor": None}
        snap = db.collection(USERS).document(name.get("uid")).get()
        return {"items": [public_profile(snap.id, snap.to_dict())] if snap.exists else [], "next_cursor": None}
    query = db.collection(USERS).order_by("created_at", direction=firestore.Query.DESCENDING)
    if cursor:
        start = db.collection(USERS).document(cursor).get()
        if not start.exists:
            raise ApiError(422, "invalid_cursor")
        query = query.start_after(start)
    snaps = list(query.limit(page_size).stream())
    return {
        "items": [public_profile(s.id, s.to_dict()) for s in snaps],
        "next_cursor": snaps[-1].id if len(snaps) == page_size else None,
    }


def admin_update_user(db: firestore.Client, admin_uid: str, uid: str, changes: dict) -> dict:
    ref = db.collection(USERS).document(uid)
    snap = ref.get()
    if not snap.exists:
        raise ApiError(404, "user_not_found")
    current = snap.to_dict()
    fields: dict[str, Any] = {}
    role = changes.get("role")
    if role is not None:
        if role not in ("user", "admin"):
            raise ApiError(422, "invalid_role")
        if uid == admin_uid and role != "admin":
            raise ApiError(409, "cannot_remove_own_admin")
        fields["role"] = role
    trust = changes.get("trust_level")
    if trust is not None and trust not in TRUST_LEVELS:
        raise ApiError(422, "invalid_trust_level")
    if fields:
        ref.update({**fields, "updated_at": firestore.SERVER_TIMESTAMP})
    if trust is not None and trust != current.get("trust_level"):
        ref.update({"trust_level": trust, "updated_at": firestore.SERVER_TIMESTAMP})
        _propagate_trust(db, current["uuid"], trust)
    return public_profile(uid, ref.get().to_dict())


def _propagate_trust(db: firestore.Client, person: str, trust: str) -> None:
    """Copia o nível novo para as gravações da pessoa e ajusta os contadores."""
    query = db.collection(RECORDINGS).where(filter=FieldFilter("uuid", "==", person))
    deltas: dict[str, int] = defaultdict(int)
    batch, pending = db.batch(), 0
    for snap in query.stream():
        current = snap.to_dict()
        if current.get("status") in HIDDEN_STATUSES:
            continue
        status = default_status(trust) if current["status"] in PENDING else current["status"]
        new_ref = counts_as_reference(status, trust)
        deltas[current["sign_id"]] += int(new_ref) - int(bool(current.get("counts_as_reference")))
        batch.update(snap.reference, {
            "user_trust_level": trust,
            "status": status,
            "counts_as_reference": new_ref,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        pending += 1
        if pending == 400:
            batch.commit()
            batch, pending = db.batch(), 0
    for sign_id, delta in deltas.items():
        if delta:
            batch.update(db.collection(SIGNS).document(sign_id), {"reference_count": firestore.Increment(delta)})
    batch.commit()


def legacy_users(db: firestore.Client) -> list[dict]:
    return [
        {
            "uuid": s.id,
            "hf_username": s.get("hf_username"),
            "trust_level": s.get("trust_level"),
            "recording_count": int(s.get("recording_count") or 0),
            "linked_uid": s.get("linked_uid"),
        }
        for s in db.collection(LEGACY).stream()
    ]


def link_legacy(db: firestore.Client, legacy_uuid: str, uid: str) -> dict:
    legacy_ref = db.collection(LEGACY).document(legacy_uuid)
    user_ref = db.collection(USERS).document(uid)

    @firestore.transactional
    def tx(t):
        legacy = legacy_ref.get(transaction=t)
        user = user_ref.get(transaction=t)
        if not legacy.exists:
            raise ApiError(404, "legacy_user_not_found")
        if not user.exists:
            raise ApiError(404, "user_not_found")
        if legacy.get("linked_uid"):
            raise ApiError(409, "legacy_already_linked")
        if int(user.get("recording_count") or 0) > 0:
            raise ApiError(409, "user_has_recordings")
        old = legacy.to_dict()
        t.update(user_ref, {
            "uuid": legacy_uuid,
            "trust_level": old.get("trust_level", "regular"),
            "sign_recordings": old.get("sign_recordings") or {},
            "recording_count": int(old.get("recording_count") or 0),
            "legacy_hf_username": old.get("hf_username"),
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        t.update(legacy_ref, {"linked_uid": uid})

    tx(db.transaction())
    return public_profile(uid, user_ref.get().to_dict())


def create_sign(db: firestore.Client, body: dict) -> dict:
    config = _catalog_config(db)
    name = str(body.get("name") or "").strip()
    video_url = str(body.get("video_url") or "").strip()
    if not name or not video_url.startswith("https://"):
        raise ApiError(422, "invalid_sign")
    try:
        slug = slugify(name)
        metadata = normalize_metadata(body.get("sign_metadata"), config["sign_metadata_schema"])
    except NamingError as exc:
        raise ApiError(422, exc.code) from exc
    if list(db.collection(SIGNS).where(filter=FieldFilter("slug", "==", slug)).limit(1).stream()):
        raise ApiError(409, "slug_taken", slug=slug)
    sign_id = str(uuid_lib.uuid4())
    db.collection(SIGNS).document(sign_id).set({
        "slug": slug,
        "name": name,
        "video_url": video_url,
        "metadata": metadata,
        "active": True,
        "order": int(body.get("order") or 0),
        "recording_count": 0,
        "accepted_count": 0,
        "reference_count": 0,
        "created_at": firestore.SERVER_TIMESTAMP,
        "updated_at": firestore.SERVER_TIMESTAMP,
    })
    return public_sign(sign_id, db.collection(SIGNS).document(sign_id).get().to_dict())


def update_sign(db: firestore.Client, sign_id: str, body: dict) -> dict:
    ref = db.collection(SIGNS).document(sign_id)
    if not ref.get().exists:
        raise ApiError(404, "sign_not_found")
    fields: dict[str, Any] = {}
    if "name" in body:
        name = str(body["name"] or "").strip()
        if not name:
            raise ApiError(422, "invalid_sign")
        fields["name"] = name
    if "video_url" in body:
        if not str(body["video_url"] or "").startswith("https://"):
            raise ApiError(422, "invalid_sign")
        fields["video_url"] = body["video_url"]
    if "sign_metadata" in body:
        try:
            fields["metadata"] = normalize_metadata(body["sign_metadata"], _catalog_config(db)["sign_metadata_schema"])
        except NamingError as exc:
            raise ApiError(422, exc.code) from exc
    if "active" in body:
        fields["active"] = bool(body["active"])
    if "order" in body:
        fields["order"] = int(body["order"] or 0)
    if fields:
        ref.update({**fields, "updated_at": firestore.SERVER_TIMESTAMP})
    return public_sign(sign_id, ref.get().to_dict())


def update_metadata_schema(db: firestore.Client, schema: Any) -> dict:
    try:
        valid = validate_metadata_schema(schema)
    except NamingError as exc:
        raise ApiError(422, exc.code) from exc
    config = _catalog_config(db)
    major = int(str(config["schema_version"]).split(".")[0])
    db.collection(CONFIG).document("sign_catalog").set(
        {"schema_version": f"{major + 1}.0", "sign_metadata_schema": valid}
    )
    batch = db.batch()
    for snap in db.collection(SIGNS).stream():
        current = snap.get("metadata") or {}
        batch.update(snap.reference, {"metadata": {k: bool(current.get(k, False)) for k in valid}})
    batch.commit()
    return catalog(db, include_inactive=True)


def rebuild_reference_profiles(db: firestore.Client, storage: Storage, min_references: int) -> dict:
    query = db.collection(RECORDINGS).where(filter=FieldFilter("counts_as_reference", "==", True))
    grouped: dict[str, list[dict]] = defaultdict(list)
    errors = []
    total = 0
    for snap in query.stream():
        total += 1
        try:
            grouped[snap.get("sign_id")].append(m.recording_metrics(read_npz(storage.get(snap.get("path")))))
        except Exception as exc:  # um arquivo ruim não impede o resto
            errors.append({"id": snap.id, "error": type(exc).__name__})
    data = {
        "schema_version": "1.0",
        "min_references": int(min_references),
        "profiles": {sign_id: m.build_profile(items) for sign_id, items in sorted(grouped.items())},
        "build": {
            "source_rule": "sample_status=accepted and user_trust_level=expert",
            "reference_samples": total,
            "usable_reference_samples": sum(len(v) for v in grouped.values()),
            "errors": errors,
            "built_at": _now().isoformat(),
        },
    }
    db.collection(CONFIG).document("reference_profiles").set(data)
    clear_caches()
    return data
