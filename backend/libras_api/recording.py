"""Convert the browser upload to `.npz`, and `.npz` to replay data."""
from __future__ import annotations

import io
from typing import Any

import numpy as np

from .hands import active_hand, assign_hands

SCHEMA_VERSION = "1.1"
FRAMES = 30
TARGET_FPS = 15.0
POSE_POINTS, POSE_DIMS = 33, 4
HAND_POINTS, HAND_DIMS = 21, 3
LABEL_CODES = {None: 0, "Left": 1, "Right": 2}


class PayloadError(ValueError):
    """The upload has a bad format. The API sends `code` to the client."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _frames_to_array(frames: Any, points: int, dims: int, name: str) -> tuple[np.ndarray, np.ndarray]:
    if not isinstance(frames, list) or len(frames) != FRAMES:
        raise PayloadError(f"invalid_{name}_frames")
    arr = np.zeros((FRAMES, points, dims), dtype=np.float32)
    mask = np.zeros(FRAMES, dtype=np.uint8)
    for i, frame in enumerate(frames):
        if frame is None:
            continue
        try:
            values = np.asarray(frame, dtype=np.float32)
        except (TypeError, ValueError) as exc:
            raise PayloadError(f"invalid_{name}_values") from exc
        if values.shape != (points, dims):
            raise PayloadError(f"invalid_{name}_shape")
        if not np.isfinite(values).all():
            raise PayloadError(f"invalid_{name}_values")
        arr[i] = values
        mask[i] = 1
    return arr, mask


def _labels(raw: Any) -> np.ndarray:
    labels = np.zeros((FRAMES, 2), dtype=np.uint8)
    if raw is None:
        return labels
    if not isinstance(raw, list) or len(raw) != FRAMES:
        raise PayloadError("invalid_hand_labels")
    for i, pair in enumerate(raw):
        if not isinstance(pair, list) or len(pair) != 2 or any(v not in LABEL_CODES for v in pair):
            raise PayloadError("invalid_hand_labels")
        labels[i] = [LABEL_CODES[v] for v in pair]
    return labels


def _int(meta: dict, key: str, default: int, low: int, high: int) -> int:
    try:
        value = int(round(float(meta.get(key, default))))
    except (TypeError, ValueError):
        return default
    return min(max(value, low), high)


def parse_upload(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate the upload. Return the arrays with the hands assigned by wrist."""
    pose, pose_mask = _frames_to_array(payload.get("pose"), POSE_POINTS, POSE_DIMS, "pose")
    left, left_mask = _frames_to_array(payload.get("left_hand"), HAND_POINTS, HAND_DIMS, "left_hand")
    right, right_mask = _frames_to_array(payload.get("right_hand"), HAND_POINTS, HAND_DIMS, "right_hand")
    labels = _labels(payload.get("hand_labels"))
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}

    data = {"pose": pose, "pose_mask": pose_mask}
    data.update(assign_hands(pose, pose_mask, left, left_mask, right, right_mask, labels))
    data["meta"] = {
        "raw_frame_count": _int(meta, "raw_frame_count", FRAMES, 0, 1000),
        "duration_ms": _int(meta, "duration_ms", 2000, 0, 60000),
        "record_duration_ms": _int(meta, "record_duration_ms", 2000, 0, 60000),
        "video_width": _int(meta, "video_width", 0, 0, 10000),
        "video_height": _int(meta, "video_height", 0, 0, 10000),
    }
    data["active_hand"] = active_hand(data["left_hand"], data["left_mask"], data["right_hand"], data["right_mask"])
    return data


def to_npz_bytes(data: dict[str, Any], sign_id: str, video_idx: int, capture_version: str) -> bytes:
    meta = data["meta"]
    buf = io.BytesIO()
    np.savez_compressed(
        buf,
        schema_version=np.array(SCHEMA_VERSION),
        capture_version=np.array(capture_version),
        sinal_id=np.array(sign_id),
        video_idx=np.array(video_idx, dtype=np.int16),
        frame_count=np.array(FRAMES, dtype=np.int16),
        raw_frame_count=np.array(meta["raw_frame_count"], dtype=np.int16),
        duration_ms=np.array(meta["duration_ms"], dtype=np.int32),
        target_fps=np.array(TARGET_FPS, dtype=np.float32),
        target_frame_count=np.array(FRAMES, dtype=np.int16),
        record_duration_ms=np.array(meta["record_duration_ms"], dtype=np.int32),
        video_width=np.array(meta["video_width"], dtype=np.int16),
        video_height=np.array(meta["video_height"], dtype=np.int16),
        pose=data["pose"],
        pose_mask=data["pose_mask"],
        left_hand=data["left_hand"],
        left_mask=data["left_mask"],
        right_hand=data["right_hand"],
        right_mask=data["right_mask"],
        hand_labels=data["hand_labels"],
    )
    return buf.getvalue()


def read_npz(payload: bytes) -> dict[str, np.ndarray]:
    with np.load(io.BytesIO(payload), allow_pickle=False) as npz:
        return {name: npz[name] for name in npz.files}


def replay_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Return landmarks in the format that the browser replay draws (x, y[, visibility])."""

    def points(key: str, cols: list[int]) -> list:
        arr = data.get(key)
        if not isinstance(arr, np.ndarray) or arr.ndim != 3 or arr.shape[2] <= max(cols):
            return []
        xy = np.nan_to_num(arr[:, :, cols].astype(np.float64), nan=0.0, posinf=0.0, neginf=0.0)
        return np.round(xy, 4).tolist()

    def mask(key: str) -> list:
        arr = data.get(key)
        return arr.astype(int).tolist() if isinstance(arr, np.ndarray) else []

    fps = float(data.get("target_fps", TARGET_FPS)) or TARGET_FPS
    pose = points("pose", [0, 1, 3])
    return {
        "frame_count": len(pose),
        "fps": fps,
        "pose": pose,
        "pose_mask": mask("pose_mask"),
        "left_hand": points("left_hand", [0, 1]),
        "left_mask": mask("left_mask"),
        "right_hand": points("right_hand", [0, 1]),
        "right_mask": mask("right_mask"),
    }
