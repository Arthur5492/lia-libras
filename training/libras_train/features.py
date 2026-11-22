"""Make the model input from a recording: resample, mirror and compute the features.

The features are the ones of lstm_libras/features.py (196 numbers for each frame): the upper body relative
to the shoulders, the two hands relative to the wrist, and the shape of each hand. They now use the world
landmarks, which are in meters, so the aspect ratio of the camera does not change the shapes.
Any change here needs a new FEATURE_VERSION, and the inference code in the site must change in the same way.
"""
from __future__ import annotations

import numpy as np

from .data import PER_FRAME

FEATURE_VERSION = "1"

POSE_INDEXES = list(range(11, 25))  # Shoulders, elbows, wrists, fingers and hips. No face and no legs.
HAND_GEOMETRY_COUNT = 14
FEATURE_SIZE = len(POSE_INDEXES) * 3 + 21 * 3 * 2 + HAND_GEOMETRY_COUNT * 2  # 196

WRIST, THUMB_BASE, THUMB_MID, THUMB_TIP = 0, 2, 3, 4
FINGERS = ((5, 6, 8), (9, 10, 12), (13, 14, 16), (17, 18, 20))  # Base, middle joint and tip.
EPSILON = 1e-6

# Pairs of pose points that swap sides when the image is mirrored.
_POSE_PAIRS = [(1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16), (17, 18), (19, 20),
               (21, 22), (23, 24), (25, 26), (27, 28), (29, 30), (31, 32)]
POSE_SWAP = np.arange(33)
for _a, _b in _POSE_PAIRS:
    POSE_SWAP[_a], POSE_SWAP[_b] = _b, _a


def resample(arrays: dict, frames: int) -> dict:
    """Take `frames` frames at equal steps of time, from the first to the last. Each one is the nearest real frame."""
    times = np.asarray(arrays["timestamps_ms"], dtype=np.float64)
    wanted = np.linspace(times[0], times[-1], frames)
    index = np.abs(times[None, :] - wanted[:, None]).argmin(axis=1)
    out = {k: arrays[k][index] for k in PER_FRAME}
    out["meta"] = arrays["meta"]
    return out


def mirror(arrays: dict) -> dict:
    """The recording as if the person used the other hand: image x -> 1 - x, world x -> -x, sides swap."""
    out = dict(arrays)
    out["pose"] = arrays["pose"][:, POSE_SWAP].copy()
    out["pose_world"] = arrays["pose_world"][:, POSE_SWAP].copy()
    out["pose"][..., 0] = np.where(arrays["pose_mask"][:, None] == 1, 1 - out["pose"][..., 0], 0)
    out["pose_world"][..., 0] *= -1
    for side, other in (("left", "right"), ("right", "left")):
        image, world = arrays[f"{other}_hand"].copy(), arrays[f"{other}_hand_world"].copy()
        mask = arrays[f"{other}_mask"]
        image[..., 0] = np.where(mask[:, None] == 1, 1 - image[..., 0], 0)
        world[..., 0] *= -1
        out[f"{side}_hand"], out[f"{side}_hand_world"], out[f"{side}_mask"] = image, world, mask.copy()
    return out


def _flexion(base: np.ndarray, middle: np.ndarray, tip: np.ndarray) -> float:
    """About 1 for a straight finger, and about -1 for a folded finger."""
    a, b = middle - base, tip - middle
    product = np.linalg.norm(a) * np.linalg.norm(b)
    return 0.0 if product < EPSILON else float(np.clip(np.dot(a, b) / product, -1.0, 1.0))


def hand_shape(hand: np.ndarray) -> np.ndarray:
    """14 numbers about the shape of one hand (21 x 3), that do not change with position, size or rotation."""
    scale = np.linalg.norm(hand[9] - hand[WRIST])
    scale = 1.0 if scale < EPSILON else scale
    tip = hand[THUMB_TIP]
    to_tips = [np.linalg.norm(tip - hand[f[2]]) / scale for f in FINGERS]
    to_bases = [np.linalg.norm(tip - hand[f[0]]) / scale for f in FINGERS]
    flexions = [_flexion(hand[f[0]], hand[f[1]], hand[f[2]]) for f in FINGERS]
    thumb = _flexion(hand[THUMB_BASE], hand[THUMB_MID], hand[THUMB_TIP])
    spread = np.linalg.norm(hand[8] - hand[20]) / scale
    return np.array(to_tips + to_bases + flexions + [thumb, spread], dtype=np.float32)


def _hand_block(hand: np.ndarray, present: bool) -> np.ndarray:
    if not present:
        return np.zeros(21 * 3 + HAND_GEOMETRY_COUNT, dtype=np.float32)
    scale = np.linalg.norm(hand[9] - hand[WRIST])
    scale = 1.0 if scale < EPSILON else scale
    return np.concatenate([((hand - hand[WRIST]) / scale).ravel(), hand_shape(hand)]).astype(np.float32)


def features(arrays: dict) -> np.ndarray:
    """Return an array (frames, FEATURE_SIZE)."""
    rows = []
    for i in range(len(arrays["pose_mask"])):
        if arrays["pose_mask"][i]:
            pose = arrays["pose_world"][i]
            center = (pose[11] + pose[12]) / 2
            scale = np.linalg.norm(pose[11] - pose[12])
            scale = 1.0 if scale < EPSILON else scale
            body = ((pose[POSE_INDEXES] - center) / scale).ravel()
        else:
            body = np.zeros(len(POSE_INDEXES) * 3)
        left = _hand_block(arrays["left_hand_world"][i], bool(arrays["left_mask"][i]))
        right = _hand_block(arrays["right_hand_world"][i], bool(arrays["right_mask"][i]))
        rows.append(np.concatenate([body, left, right]))
    result = np.asarray(rows, dtype=np.float32)
    assert result.shape[1] == FEATURE_SIZE
    return result
