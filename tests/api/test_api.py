"""API tests on the Auth and Firestore emulators, with the bucket in a local folder."""
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.libras_api.recording import read_npz
from tests.api.conftest import make_payload

pytestmark = pytest.mark.emulator


def _doc(db, collection, doc_id):
    return db.collection(collection).document(doc_id).get().to_dict()


# ---------- registration ----------

def test_no_token_and_no_profile(client, signup):
    assert client.get("/api/me").json()["code"] == "missing_token"
    assert client.get("/api/me", headers={"Authorization": "Bearer x"}).json()["code"] == "invalid_token"
    p = signup()
    resp = p.get("/api/me")
    assert resp.status_code == 403 and resp.json()["code"] == "not_registered"


def test_registration(signup, db):
    p = signup()
    assert p.get("/api/usernames/Jose_1/available").json() == {"username_key": "jose_1", "available": True}
    resp = p.post("/api/me", json={"username": "José_1", "consent_version": "v1"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["trust_level"] == "regular" and body["role"] == "user" and body["show_in_ranking"] is False
    assert _doc(db, "usernames", "jose_1")["uid"] == p.uid
    assert "email" not in _doc(db, "users", p.uid)
    assert p.post("/api/me", json={"username": "outro", "consent_version": "v1"}).json()["code"] == "already_registered"

    other = signup()
    for name in ("jose_1", "JOSÉ_1"):
        resp = other.post("/api/me", json={"username": name, "consent_version": "v1"})
        assert resp.status_code == 409 and resp.json()["code"] == "username_taken"
    assert other.post("/api/me", json={"username": "admin", "consent_version": "v1"}).json()["code"] == "blocked_username"
    assert other.post("/api/me", json={"username": "semtermo"}).json()["code"] == "consent_required"


def test_concurrent_username_only_one_wins(signup, db):
    people = [signup() for _ in range(6)]

    def attempt(p):
        return p.post("/api/me", json={"username": "disputado", "consent_version": "v1"}).status_code

    with ThreadPoolExecutor(6) as pool:
        codes = list(pool.map(attempt, people))
    assert codes.count(201) == 1 and codes.count(409) == 5
    assert len(list(db.collection("users").stream())) == 1


def test_cannot_change_own_trust_level(person, db):
    p = person()
    p.patch("/api/me", json={"show_in_ranking": True, "trust_level": "expert", "role": "admin"})
    data = _doc(db, "users", p.uid)
    assert data["show_in_ranking"] is True and data["trust_level"] == "regular" and data["role"] == "user"


# ---------- upload ----------

def test_upload(person, sign, db, bucket):
    p = person()
    sign_id = sign("amor")
    resp = p.post("/api/recordings", json=make_payload(sign_id, swap_channels=True))
    assert resp.status_code == 201, resp.text
    rec = resp.json()["recording"]
    assert rec["status"] == "unreviewed" and rec["video_idx"] == 1 and rec["active_hand"] == "right"
    assert rec["right_hand_rate"] == 1.0 and rec["left_hand_rate"] == 0.0
    assert resp.json()["replay"]["frame_count"] == 30

    npz = read_npz((bucket / "amor" / p.uuid / "01.npz").read_bytes())
    assert str(npz["schema_version"]) == "1.1" and str(npz["sinal_id"]) == sign_id
    assert npz["right_mask"].all() and not npz["left_mask"].any()

    assert _doc(db, "users", p.uid)["recording_count"] == 1
    assert _doc(db, "users", p.uid)["sign_recordings"] == {sign_id: [1]}
    assert _doc(db, "signs", sign_id)["recording_count"] == 1


def test_trust_level_sets_initial_status(person, sign):
    sign_id = sign()
    resp = person("trusted").post("/api/recordings", json=make_payload(sign_id))
    assert resp.json()["recording"]["status"] == "trusted_unreviewed"


def test_retry_does_not_duplicate(person, sign, db):
    p = person()
    sign_id = sign()
    payload = make_payload(sign_id)
    first = p.post("/api/recordings", json=payload)
    again = p.post("/api/recordings", json=payload)
    assert first.status_code == 201 and again.status_code == 200 and again.json()["duplicate"] is True
    assert again.json()["recording"]["id"] == first.json()["recording"]["id"]
    assert _doc(db, "users", p.uid)["recording_count"] == 1
    assert _doc(db, "signs", sign_id)["recording_count"] == 1


def test_client_id_of_another_person(person, sign):
    sign_id = sign()
    payload = make_payload(sign_id)
    person().post("/api/recordings", json=payload)
    resp = person().post("/api/recordings", json=payload)
    assert resp.status_code == 409 and resp.json()["code"] == "client_id_conflict"


def test_bad_recording_is_not_saved(person, sign, db, bucket):
    p = person()
    sign_id = sign("ruim")
    resp = p.post("/api/recordings", json=make_payload(sign_id, pose_missing=10, hand_missing=25))
    assert resp.status_code == 422
    assert resp.json()["code"] == "low_quality"
    assert set(resp.json()["validation_flags"]) == {"low_pose_rate", "low_any_hand_rate"}
    assert not (bucket / "ruim").exists()
    assert _doc(db, "users", p.uid)["recording_count"] == 0
    assert list(db.collection("recordings").stream()) == []


def test_unknown_or_inactive_sign(person, sign):
    p = person()
    for sign_id in ("nao-existe", sign("parado", active=False)):
        resp = p.post("/api/recordings", json=make_payload(sign_id))
        assert resp.status_code == 422 and resp.json()["code"] == "unknown_sign"


def test_limit_per_sign_and_index_reuse(person, sign, db, bucket):
    p = person()
    sign_id = sign("limite")
    ids = [p.post("/api/recordings", json=make_payload(sign_id)).json()["recording"]["id"] for _ in range(4)]
    resp = p.post("/api/recordings", json=make_payload(sign_id))
    assert resp.status_code == 409 and resp.json()["code"] == "sign_complete"

    assert p.delete(f"/api/me/recordings/{ids[1]}").status_code == 204
    assert not (bucket / "limite" / p.uuid / "02.npz").exists()
    assert db.collection("recordings").document(ids[1]).get().exists is False
    assert _doc(db, "users", p.uid)["recording_count"] == 3

    again = p.post("/api/recordings", json=make_payload(sign_id))
    assert again.status_code == 201 and again.json()["recording"]["video_idx"] == 2
    assert _doc(db, "signs", sign_id)["recording_count"] == 4
    assert len(p.get("/api/me/recordings").json()["items"]) == 4


def test_does_not_reuse_index_missing_from_map(person, sign, db):
    """Do not overwrite a recording that the user map does not know (for example, after migration)."""
    p = person()
    sign_id = sign()
    db.collection("recordings").document(f"{p.uuid}_{sign_id}_01").set({"status": "accepted", "uuid": p.uuid})
    resp = p.post("/api/recordings", json=make_payload(sign_id))
    assert resp.json()["recording"]["video_idx"] == 2
    assert _doc(db, "recordings", f"{p.uuid}_{sign_id}_01")["status"] == "accepted"


def test_bucket_failure_releases_index(person, sign, db, monkeypatch):
    from backend.libras_api.storage import get_storage

    p = person()
    sign_id = sign()

    def broken(*_):
        raise OSError("unavailable")

    monkeypatch.setattr(get_storage(), "put", broken)
    resp = p.post("/api/recordings", json=make_payload(sign_id))
    assert resp.status_code == 502 and resp.json()["code"] == "storage_error"
    assert _doc(db, "users", p.uid)["sign_recordings"] == {sign_id: []}
    assert list(db.collection("recordings").stream()) == []


def test_delete_only_own(person, sign):
    sign_id = sign()
    owner, other = person(), person()
    rec_id = owner.post("/api/recordings", json=make_payload(sign_id)).json()["recording"]["id"]
    assert other.delete(f"/api/me/recordings/{rec_id}").status_code == 404
    assert owner.delete(f"/api/me/recordings/{rec_id}").status_code == 204
    assert owner.delete(f"/api/me/recordings/{rec_id}").status_code == 404


def test_replay(person, sign):
    sign_id = sign()
    owner, other, reviewer = person(), person(), person("trusted")
    rec_id = owner.post("/api/recordings", json=make_payload(sign_id)).json()["recording"]["id"]
    resp = owner.get(f"/api/recordings/{rec_id}/replay")
    assert resp.status_code == 200 and resp.json()["frame_count"] == 30 and len(resp.json()["pose"][0][0]) == 3
    assert other.get(f"/api/recordings/{rec_id}/replay").status_code == 404
    assert reviewer.get(f"/api/recordings/{rec_id}/replay").status_code == 200


# ---------- review ----------

def test_review_permissions(person, sign, db):
    sign_id = sign()
    regular, trusted, expert = person(), person("trusted"), person("expert")
    own = trusted.post("/api/recordings", json=make_payload(sign_id)).json()["recording"]["id"]
    rec = regular.post("/api/recordings", json=make_payload(sign_id)).json()["recording"]["id"]

    assert regular.get("/api/review/recordings?status=unreviewed").json()["code"] == "reviewer_only"
    resp = trusted.patch("/api/review/recordings", json={"updates": [{"id": own, "status": "accepted"}]})
    assert resp.status_code == 403 and resp.json()["code"] == "cannot_review_own"

    resp = expert.patch("/api/review/recordings", json={"updates": [
        {"id": own, "status": "accepted"}, {"id": rec, "status": "rejected"},
    ]})
    assert resp.status_code == 200, resp.text
    assert _doc(db, "recordings", own)["reviewed_by"] == expert.uid
    assert _doc(db, "signs", sign_id)["accepted_count"] == 1
    # The author is trusted, so an accepted recording is not a reference.
    assert _doc(db, "signs", sign_id)["reference_count"] == 0

    trusted.patch("/api/review/recordings", json={"updates": [{"id": rec, "status": "pending"}]})
    assert _doc(db, "recordings", rec)["status"] == "unreviewed"
    assert _doc(db, "recordings", rec)["reviewed_by"] is None


def test_reference_and_counters(person, sign, db):
    sign_id = sign()
    expert, reviewer = person("expert"), person("trusted")
    rec = expert.post("/api/recordings", json=make_payload(sign_id)).json()["recording"]["id"]
    reviewer.patch("/api/review/recordings", json={"updates": [{"id": rec, "status": "accepted"}]})
    assert _doc(db, "recordings", rec)["counts_as_reference"] is True
    assert _doc(db, "signs", sign_id)["reference_count"] == 1
    expert.delete(f"/api/me/recordings/{rec}")
    counters = _doc(db, "signs", sign_id)
    assert (counters["recording_count"], counters["accepted_count"], counters["reference_count"]) == (0, 0, 0)


def test_review_list(person, sign, db):
    a, b = sign("a"), sign("b")
    p1, p2, reviewer = person(), person(), person("trusted")
    for _ in range(2):
        p1.post("/api/recordings", json=make_payload(a))
    p2.post("/api/recordings", json=make_payload(b))
    db.collection("recordings").document(f"{p2.uuid}_{b}_01").update({"validation_flags": ["low_motion_reference"]})

    assert reviewer.get("/api/review/recordings").status_code == 422
    assert reviewer.get("/api/review/recordings?status=deleted").json()["code"] == "invalid_status"
    many = reviewer.get(f"/api/review/recordings?status=unreviewed&sign_id={a}&flag=x")
    assert many.json()["code"] == "too_many_filters"

    def ids(query):
        return [i["id"] for i in reviewer.get(f"/api/review/recordings?status=unreviewed{query}").json()["items"]]

    assert len(ids("")) == 3
    assert len(ids(f"&sign_id={a}")) == 2
    assert ids("&flag=low_motion_reference") == [f"{p2.uuid}_{b}_01"]
    assert len(ids("&username=pessoa_1")) == 2
    assert ids("&username=ninguem") == []
    assert len(ids("&trust_level=regular")) == 3

    page = reviewer.get("/api/review/recordings?status=unreviewed&limit=2").json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    rest = reviewer.get(f"/api/review/recordings?status=unreviewed&limit=2&cursor={page['next_cursor']}").json()
    assert len(rest["items"]) == 1 and rest["next_cursor"] is None


# ---------- administration ----------

def test_admin_changes_level_and_propagates(person, sign, db):
    sign_id = sign()
    admin, p, reviewer = person(role="admin"), person(), person("trusted")
    assert p.get("/api/admin/users").json()["code"] == "admin_only"
    recs = [p.post("/api/recordings", json=make_payload(sign_id)).json()["recording"]["id"] for _ in range(2)]
    reviewer.patch("/api/review/recordings", json={"updates": [{"id": recs[0], "status": "accepted"}]})

    resp = admin.patch(f"/api/admin/users/{p.uid}", json={"trust_level": "expert"})
    assert resp.status_code == 200 and resp.json()["trust_level"] == "expert"
    first, second = _doc(db, "recordings", recs[0]), _doc(db, "recordings", recs[1])
    assert first["counts_as_reference"] is True and first["user_trust_level"] == "expert"
    assert second["status"] == "trusted_unreviewed"
    assert _doc(db, "signs", sign_id)["reference_count"] == 1

    admin.patch(f"/api/admin/users/{p.uid}", json={"trust_level": "regular"})
    assert _doc(db, "signs", sign_id)["reference_count"] == 0
    assert _doc(db, "recordings", recs[1])["status"] == "unreviewed"

    resp = admin.patch(f"/api/admin/users/{admin.uid}", json={"role": "user"})
    assert resp.json()["code"] == "cannot_remove_own_admin"
    assert admin.get("/api/admin/users?username=pessoa_2").json()["items"][0]["uid"] == p.uid


def test_catalog(person, client, db):
    admin = person(role="admin")
    db.collection("config").document("sign_catalog").set({
        "schema_version": "1.0", "sign_metadata_schema": {"is_dynamic": {"type": "boolean", "label": "Dinâmico"}},
    })
    resp = admin.post("/api/admin/signs", json={
        "name": "À vista", "video_url": "https://example.com/v.mp4", "sign_metadata": {"is_dynamic": True},
    })
    assert resp.status_code == 201 and resp.json()["slug"] == "a-vista"
    sign_id = resp.json()["id"]
    dup = admin.post("/api/admin/signs", json={"name": "A vista", "video_url": "https://example.com/x.mp4"})
    assert dup.status_code == 409 and dup.json()["code"] == "slug_taken"

    renamed = admin.patch(f"/api/admin/signs/{sign_id}", json={"name": "À vista (pagamento)"}).json()
    assert renamed["slug"] == "a-vista"

    public = client.get("/api/signs")
    assert "s-maxage" in public.headers["cache-control"]
    assert [s["slug"] for s in public.json()["signs"]] == ["a-vista"]
    admin.patch(f"/api/admin/signs/{sign_id}", json={"active": False})
    assert client.get("/api/signs").json()["signs"] == []

    schema = admin.put("/api/admin/sign-metadata-schema", json={"sign_metadata_schema": {
        "is_two_handed": {"type": "boolean", "label": "Duas mãos"},
    }}).json()
    assert schema["schema_version"] == "2.0"
    assert schema["signs"][0]["sign_metadata"] == {"is_two_handed": False}


def test_reference_profiles(person, sign, db):
    sign_id = sign()
    admin, expert = person(role="admin"), person("expert")
    recs = [expert.post("/api/recordings", json=make_payload(sign_id)).json()["recording"]["id"] for _ in range(3)]
    admin.patch("/api/review/recordings", json={"updates": [{"id": r, "status": "accepted"} for r in recs]})

    built = admin.post("/api/admin/reference-profiles/rebuild", json={"min_references": 3}).json()
    profile = built["profiles"][sign_id]
    assert profile["reference_count"] == 3 and profile["min_any_hand_rate"] == 1.0
    assert built["build"]["errors"] == []

    # With an active profile, a static recording gets a warning, but the API saves it.
    still = make_payload(sign_id)
    for frame in still["right_hand"]:
        for point in frame:
            point[0] = 0.35
    resp = person().post("/api/recordings", json=still)
    assert resp.status_code == 201
    assert "low_motion_reference" in resp.json()["recording"]["validation_flags"]


def test_stats(person, sign, client):
    sign_id = sign()
    shown, hidden = person(show_in_ranking=True), person()
    shown.post("/api/recordings", json=make_payload(sign_id))
    hidden.post("/api/recordings", json=make_payload(sign_id))
    body = client.get("/api/stats").json()
    assert body["total_recordings"] == 2
    assert body["ranking"] == [{"username": "pessoa_1", "recording_count": 1}]
