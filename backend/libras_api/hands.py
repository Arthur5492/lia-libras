"""Hand assignment by pose wrist, and active hand. See contract/npz.md."""
from __future__ import annotations

import numpy as np

LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT, RIGHT = 0, 1


def _dist(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b))


def _choose_channels(
    hands: list[tuple[np.ndarray, int]],
    anchors: list[np.ndarray | None],
) -> list[int]:
    """Return the channel for each hand. `hands` = [(wrist xy, source channel)]."""
    if not hands:
        return []
    known = anchors[LEFT] is not None and anchors[RIGHT] is not None
    if len(hands) == 1:
        wrist, original = hands[0]
        if not known:
            return [original]
        return [LEFT if _dist(wrist, anchors[LEFT]) <= _dist(wrist, anchors[RIGHT]) else RIGHT]
    (a, a_orig), (b, b_orig) = hands
    if not known:
        if a_orig != b_orig:
            return [a_orig, b_orig]
        return [LEFT, RIGHT]
    direct = _dist(a, anchors[LEFT]) + _dist(b, anchors[RIGHT])
    crossed = _dist(a, anchors[RIGHT]) + _dist(b, anchors[LEFT])
    return [LEFT, RIGHT] if direct <= crossed else [RIGHT, LEFT]


def assign_hands(
    pose: np.ndarray,
    pose_mask: np.ndarray,
    left: np.ndarray,
    left_mask: np.ndarray,
    right: np.ndarray,
    right_mask: np.ndarray,
    labels: np.ndarray | None = None,
) -> dict[str, np.ndarray]:
    """Put each hand in the channel of the nearest pose wrist.

    The function is idempotent: a second run gives the same result.
    `labels` (n, 2) moves with the hand when the hand changes channel.
    """
    n = len(pose)
    src = (left, right)
    src_mask = (left_mask.astype(bool), right_mask.astype(bool))
    out = (np.zeros_like(left), np.zeros_like(right))
    out_mask = (np.zeros(n, dtype=np.uint8), np.zeros(n, dtype=np.uint8))
    out_labels = np.zeros_like(labels) if labels is not None else None
    last: list[np.ndarray | None] = [None, None]

    for i in range(n):
        hands = [(src[ch][i, 0, :2], ch) for ch in (LEFT, RIGHT) if src_mask[ch][i]]
        if pose_mask[i]:
            anchors: list[np.ndarray | None] = [pose[i, LEFT_WRIST, :2], pose[i, RIGHT_WRIST, :2]]
        else:
            anchors = list(last)
        for (wrist, original), channel in zip(hands, _choose_channels(hands, anchors)):
            out[channel][i] = src[original][i]
            out_mask[channel][i] = 1
            if out_labels is not None:
                out_labels[i, channel] = labels[i, original]
            last[channel] = wrist

    result = {
        "left_hand": out[LEFT],
        "left_mask": out_mask[LEFT],
        "right_hand": out[RIGHT],
        "right_mask": out_mask[RIGHT],
    }
    if out_labels is not None:
        result["hand_labels"] = out_labels
    return result


def _wrist_motion(hand: np.ndarray, mask: np.ndarray) -> float:
    points = hand[mask.astype(bool), 0, :2]
    if len(points) < 2:
        return 0.0
    return float(np.linalg.norm(np.diff(points, axis=0), axis=1).sum())


def active_hand(left: np.ndarray, left_mask: np.ndarray, right: np.ndarray, right_mask: np.ndarray) -> str:
    """Return `left`, `right` or `unknown`. Use as extra data only: it is not reliable for static signs."""
    n = len(left_mask)
    left_count, right_count = int(left_mask.sum()), int(right_mask.sum())
    if left_count == 0 and right_count == 0:
        return "unknown"
    if min(left_count, right_count) >= n * 0.5:
        return "left" if _wrist_motion(left, left_mask) >= _wrist_motion(right, right_mask) else "right"
    return "left" if left_count >= right_count else "right"
