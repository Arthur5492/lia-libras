"""Quality metrics and validation against reference profiles.

The calculation is the same as in lia_libras_dataset/src/storage.py and
adm_lia_libras_dataset/src/reference_profiles.py. This module joins the two.
"""
from __future__ import annotations

from typing import Any

import numpy as np

DEFAULT_MIN_SIMILARITY_SCORE = 0.7

REFERENCE_THRESHOLDS = {
    "min_any_hand_rate": ("any_hand_rate", "low_any_hand_rate_reference"),
    "min_both_hands_rate": ("both_hands_rate", "low_both_hands_rate_reference"),
    "min_motion_score": ("motion_score", "low_motion_reference"),
}


def _mask_rate(mask: np.ndarray) -> float:
    return float(mask.mean()) if getattr(mask, "size", 0) else 0.0


def motion_score(left: np.ndarray, left_mask: np.ndarray, right: np.ndarray, right_mask: np.ndarray) -> float:
    """Return the path length of the center of the visible hands, in image coordinates."""
    centers = []
    n_frames = max(len(left_mask), len(right_mask))
    for i in range(n_frames):
        frame_centers = []
        if i < len(left_mask) and left_mask[i] and left.shape[1] > 0:
            frame_centers.append(left[i, :, :2].mean(axis=0))
        if i < len(right_mask) and right_mask[i] and right.shape[1] > 0:
            frame_centers.append(right[i, :, :2].mean(axis=0))
        if frame_centers:
            centers.append(np.mean(frame_centers, axis=0))
    if len(centers) < 2:
        return 0.0
    points = np.asarray(centers, dtype=np.float32)
    return float(np.linalg.norm(np.diff(points, axis=0), axis=1).sum())


def recording_metrics(data: dict[str, Any]) -> dict[str, float]:
    pose_mask = np.asarray(data["pose_mask"], dtype=bool)
    left_mask = np.asarray(data["left_mask"], dtype=bool)
    right_mask = np.asarray(data["right_mask"], dtype=bool)
    n = max(len(left_mask), len(right_mask))
    left_mask = np.pad(left_mask, (0, n - len(left_mask)))
    right_mask = np.pad(right_mask, (0, n - len(right_mask)))
    return {
        "pose_rate": _mask_rate(pose_mask),
        "left_hand_rate": _mask_rate(left_mask),
        "right_hand_rate": _mask_rate(right_mask),
        "any_hand_rate": float((left_mask | right_mask).mean()) if n else 0.0,
        "both_hands_rate": float((left_mask & right_mask).mean()) if n else 0.0,
        "motion_score": motion_score(
            np.asarray(data["left_hand"], dtype=np.float32),
            left_mask,
            np.asarray(data["right_hand"], dtype=np.float32),
            right_mask,
        ),
    }


def basic_flags(metrics: dict[str, float], pose_rate_min: float, any_hand_rate_min: float) -> list[str]:
    """Return the failures that stop the save of a recording."""
    flags = []
    if metrics["pose_rate"] < pose_rate_min:
        flags.append("low_pose_rate")
    if metrics["any_hand_rate"] < any_hand_rate_min:
        flags.append("low_any_hand_rate")
    return flags


def compare_with_profile(metrics: dict[str, float], profile: dict[str, Any]) -> tuple[float | None, list[str]]:
    """Return the similarity score and the warnings for the sign profile. Warnings do not stop the save."""
    ratios, flags = [], []
    for profile_key, (metric_key, flag) in REFERENCE_THRESHOLDS.items():
        threshold = float(profile.get(profile_key) or 0.0)
        if threshold <= 0:
            continue
        value = float(metrics.get(metric_key, 0.0))
        ratios.append(max(0.0, min(value / threshold, 1.0)))
        if value < threshold:
            flags.append(flag)
    if not ratios:
        return None, flags
    score = min(ratios)
    min_similarity = float(profile.get("min_similarity_score") or 0.0)
    if min_similarity > 0 and score < min_similarity:
        flags.append("low_reference_similarity")
    return score, flags


def assess_reference(
    metrics: dict[str, float],
    profiles: dict[str, Any],
    sign_id: str,
) -> dict[str, Any]:
    profile = (profiles.get("profiles") or {}).get(sign_id)
    if not isinstance(profile, dict):
        return {"reference_count": 0, "reference_similarity_score": None, "validation_flags": []}
    count = int(profile.get("reference_count") or 0)
    min_refs = int(profile.get("min_references") or profiles.get("min_references") or 3)
    if count < min_refs:
        return {"reference_count": count, "reference_similarity_score": None, "validation_flags": []}
    score, flags = compare_with_profile(metrics, profile)
    return {"reference_count": count, "reference_similarity_score": score, "validation_flags": flags}


def _percentile_floor(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    return round(max(0.0, float(np.percentile(np.asarray(values, dtype=np.float32), percentile))), 4)


def build_profile(metrics_list: list[dict[str, float]]) -> dict[str, Any]:
    return {
        "reference_count": len(metrics_list),
        "min_any_hand_rate": _percentile_floor([m["any_hand_rate"] for m in metrics_list], 10),
        "min_both_hands_rate": _percentile_floor([m["both_hands_rate"] for m in metrics_list], 10),
        "min_motion_score": _percentile_floor([m["motion_score"] for m in metrics_list], 10),
        "min_similarity_score": DEFAULT_MIN_SIMILARITY_SCORE,
    }
