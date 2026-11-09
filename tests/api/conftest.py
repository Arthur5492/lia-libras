"""API tests. The integration tests need the emulators:

    npx --prefix tests/firestore-rules firebase emulators:exec --only auth,firestore \
        --project demo-libras ".venv/Scripts/python -m pytest"
"""
from __future__ import annotations

import os
import tempfile
import uuid
from pathlib import Path

import pytest

BUCKET_DIR = Path(tempfile.mkdtemp(prefix="libras-test-bucket-"))
os.environ["LIA_STORAGE"] = "local"
os.environ["LIA_LOCAL_BUCKET"] = str(BUCKET_DIR)
os.environ.setdefault("LIA_FIREBASE_PROJECT_ID", os.environ.get("GCLOUD_PROJECT", "demo-libras"))
os.environ["LIA_PAGE_SIZE"] = "50"

EMULATED = bool(os.environ.get("FIRESTORE_EMULATOR_HOST") and os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"))
PROJECT = os.environ["LIA_FIREBASE_PROJECT_ID"]


def pytest_collection_modifyitems(config, items):
    if EMULATED:
        return
    skip = pytest.mark.skip(reason="Firebase emulators are not running")
    for item in items:
        if "emulator" in item.keywords:
            item.add_marker(skip)


def pytest_configure(config):
    config.addinivalue_line("markers", "emulator: needs the Auth and Firestore emulators")


# ---------- synthetic data ----------

LEFT_WRIST_XY = (0.65, 0.60)
RIGHT_WRIST_XY = (0.35, 0.60)


def _hand(x: float, y: float) -> list[list[float]]:
    return [[x + 0.01 * (j % 5), y - 0.01 * (j // 5), 0.0] for j in range(21)]


def make_payload(
    sign_id: str,
    client_id: str | None = None,
    *,
    frames: int = 30,
    pose_missing: int = 0,
    hand_missing: int = 0,
    swap_channels: bool = False,
    two_hands: bool = False,
) -> dict:
    """Make a moving right hand (pose 16) and, as an option, a static left hand."""
    pose, left, right, labels = [], [], [], []
    for i in range(frames):
        dx = 0.004 * i
        if i < pose_missing:
            pose.append(None)
        else:
            points = [[0.5, 0.5, 0.0, 0.99] for _ in range(33)]
            points[11] = [0.6, 0.4, 0.0, 0.99]
            points[12] = [0.4, 0.4, 0.0, 0.99]
            points[15] = [*LEFT_WRIST_XY, 0.0, 0.99]
            points[16] = [RIGHT_WRIST_XY[0] + dx, RIGHT_WRIST_XY[1], 0.0, 0.99]
            pose.append(points)
        moving = None if i < hand_missing else _hand(RIGHT_WRIST_XY[0] + dx, RIGHT_WRIST_XY[1])
        still = _hand(*LEFT_WRIST_XY) if two_hands else None
        l_slot, r_slot = (moving, still) if swap_channels else (still, moving)
        left.append(l_slot)
        right.append(r_slot)
        # The detector puts each hand in the channel of its label. With swap, the label is wrong.
        labels.append(["Left" if l_slot else None, "Right" if r_slot else None])
    return {
        "client_id": client_id or str(uuid.uuid4()),
        "sign_id": sign_id,
        "capture_version": "test",
        "meta": {"raw_frame_count": 33, "duration_ms": 2010, "video_width": 640, "video_height": 480},
        "pose": pose,
        "left_hand": left,
        "right_hand": right,
        "hand_labels": labels,
    }


# ---------- emulators ----------

@pytest.fixture
def emulator():
    import requests

    from backend.libras_api import services

    host_fs = os.environ["FIRESTORE_EMULATOR_HOST"]
    host_auth = os.environ["FIREBASE_AUTH_EMULATOR_HOST"]
    requests.delete(f"http://{host_fs}/emulator/v1/projects/{PROJECT}/databases/(default)/documents").raise_for_status()
    requests.delete(f"http://{host_auth}/emulator/v1/projects/{PROJECT}/accounts").raise_for_status()
    services.clear_caches()
    return {"auth": host_auth}


@pytest.fixture
def db(emulator):
    from backend.libras_api.firebase import get_db

    return get_db()


@pytest.fixture
def client(emulator):
    from fastapi.testclient import TestClient

    from backend.libras_api.app import app

    return TestClient(app)


@pytest.fixture
def bucket():
    return BUCKET_DIR


class Person:
    def __init__(self, client, uid: str, token: str):
        self.client = client
        self.uid = uid
        self.token = token
        self.headers = {"Authorization": f"Bearer {token}"}

    def get(self, url, **kw):
        return self.client.get(url, headers=self.headers, **kw)

    def post(self, url, **kw):
        return self.client.post(url, headers=self.headers, **kw)

    def patch(self, url, **kw):
        return self.client.patch(url, headers=self.headers, **kw)

    def put(self, url, **kw):
        return self.client.put(url, headers=self.headers, **kw)

    def delete(self, url, **kw):
        return self.client.delete(url, headers=self.headers, **kw)


@pytest.fixture
def signup(client, emulator):
    import requests

    def _signup() -> Person:
        email = f"{uuid.uuid4().hex[:10]}@example.com"
        resp = requests.post(
            f"http://{emulator['auth']}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key",
            json={"email": email, "password": "test-password", "returnSecureToken": True},
        )
        resp.raise_for_status()
        data = resp.json()
        return Person(client, data["localId"], data["idToken"])

    return _signup


@pytest.fixture
def person(signup, db):
    """Create and register a person. Set the trust level and role directly in the database."""
    counter = iter(range(1, 1000))

    def _person(trust_level: str = "regular", role: str = "user", show_in_ranking: bool = False) -> Person:
        p = signup()
        resp = p.post("/api/me", json={
            "username": f"pessoa_{next(counter)}",
            "consent_version": "v1",
            "show_in_ranking": show_in_ranking,
        })
        assert resp.status_code == 201, resp.text
        p.uuid = resp.json()["uuid"]
        if trust_level != "regular" or role != "user":
            db.collection("users").document(p.uid).update({"trust_level": trust_level, "role": role})
        return p

    return _person


@pytest.fixture
def sign(db):
    def _sign(slug: str = "amor", active: bool = True) -> str:
        sign_id = str(uuid.uuid4())
        db.collection("signs").document(sign_id).set({
            "slug": slug, "name": slug.capitalize(), "video_url": "https://example.com/v.mp4",
            "metadata": {}, "active": active, "order": 0,
            "recording_count": 0, "accepted_count": 0, "reference_count": 0,
        })
        return sign_id

    return _sign
