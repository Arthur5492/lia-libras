"""Tests without emulators: hands, .npz format and names."""
import numpy as np
import pytest

from backend.libras_api.hands import active_hand, assign_hands
from backend.libras_api.naming import NamingError, slugify, username_key
from backend.libras_api.recording import PayloadError, parse_upload, read_npz, to_npz_bytes
from tests.api.conftest import make_payload


def _arrays(payload):
    data = parse_upload(payload)
    return data


def test_hand_in_wrong_channel_moves_to_correct_wrist():
    data = _arrays(make_payload("s", swap_channels=True))
    assert data["right_mask"].all() and not data["left_mask"].any()
    # The detector label moves with the hand.
    assert (data["hand_labels"][:, 1] == 1).all()


def test_two_hands_never_share_a_channel():
    data = _arrays(make_payload("s", two_hands=True, swap_channels=True))
    assert data["left_mask"].all() and data["right_mask"].all()
    assert np.allclose(data["left_hand"][:, 0, :2], [0.65, 0.60])


def test_assignment_is_idempotent():
    data = _arrays(make_payload("s", two_hands=True, swap_channels=True))
    again = assign_hands(
        data["pose"], data["pose_mask"], data["left_hand"], data["left_mask"],
        data["right_hand"], data["right_mask"], data["hand_labels"],
    )
    for key in ("left_hand", "right_hand", "left_mask", "right_mask", "hand_labels"):
        assert np.array_equal(again[key], data[key])


def test_no_pose_keeps_continuity():
    payload = make_payload("s", two_hands=True)
    for i in range(10, 15):
        payload["pose"][i] = None
        payload["left_hand"][i], payload["right_hand"][i] = payload["right_hand"][i], payload["left_hand"][i]
    data = _arrays(payload)
    assert np.allclose(data["left_hand"][10:15, 0, :2], [0.65, 0.60])


def test_no_pose_and_no_history_keeps_source_channel():
    payload = make_payload("s", pose_missing=30)
    data = _arrays(payload)
    assert data["right_mask"].all() and not data["left_mask"].any()


def test_active_hand():
    data = _arrays(make_payload("s", two_hands=True))
    assert active_hand(data["left_hand"], data["left_mask"], data["right_hand"], data["right_mask"]) == "right"
    empty = np.zeros((30, 21, 3), np.float32)
    zeros = np.zeros(30, np.uint8)
    assert active_hand(empty, zeros, empty, zeros) == "unknown"


@pytest.mark.parametrize("change, code", [
    (lambda p: p.update(pose=p["pose"][:29]), "invalid_pose_frames"),
    (lambda p: p["pose"][3][0].__setitem__(0, float("nan")), "invalid_pose_values"),
    (lambda p: p["left_hand"].__setitem__(0, [[0, 0, 0]] * 20), "invalid_left_hand_shape"),
    (lambda p: p.update(hand_labels=[["Up", None]] * 30), "invalid_hand_labels"),
])
def test_bad_upload_format(change, code):
    payload = make_payload("s")
    change(payload)
    with pytest.raises(PayloadError) as exc:
        parse_upload(payload)
    assert exc.value.code == code


def test_npz_follows_contract_1_1():
    data = _arrays(make_payload("s", two_hands=True))
    npz = read_npz(to_npz_bytes(data, "sign-uuid", 3, "test"))
    expected = {
        "schema_version": ((), "<U3"), "capture_version": ((), "<U4"), "sinal_id": ((), "<U9"),
        "video_idx": ((), "int16"), "frame_count": ((), "int16"), "raw_frame_count": ((), "int16"),
        "duration_ms": ((), "int32"), "target_fps": ((), "float32"), "target_frame_count": ((), "int16"),
        "record_duration_ms": ((), "int32"), "video_width": ((), "int16"), "video_height": ((), "int16"),
        "pose": ((30, 33, 4), "float32"), "pose_mask": ((30,), "uint8"),
        "left_hand": ((30, 21, 3), "float32"), "left_mask": ((30,), "uint8"),
        "right_hand": ((30, 21, 3), "float32"), "right_mask": ((30,), "uint8"),
        "hand_labels": ((30, 2), "uint8"),
    }
    assert set(npz) == set(expected)
    for key, (shape, dtype) in expected.items():
        assert npz[key].shape == shape and str(npz[key].dtype) == dtype, key
    assert str(npz["schema_version"]) == "1.1" and int(npz["video_idx"]) == 3


def test_username():
    assert username_key("José_1") == "jose_1"
    for bad in ("ab", "nome com espaço", "x" * 21, "日本語語"):
        with pytest.raises(NamingError):
            username_key(bad)
    with pytest.raises(NamingError) as exc:
        username_key("Admin")
    assert exc.value.code == "blocked_username"
    with pytest.raises(NamingError):
        username_key("feio_demais", ["feio"])


def test_slug():
    assert slugify("À vista") == "a-vista"
    assert slugify("Letra A") == "letra-a"
