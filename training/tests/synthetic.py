"""Fake recordings and releases for the tests. The format is the one of contract/npz.md."""
from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np


def make_arrays(kind: str, person: int, frames: int = 40, seed: int = 0) -> dict:
    """The right hand moves to the right (kind "a") or up (kind "b"). Each person has an own offset and noise."""
    rng = np.random.default_rng(1000 * person + seed)
    offset = rng.normal(0, 0.03, 2)
    steps = np.linspace(0, 0.3, frames)
    pose = np.zeros((frames, 33, 4), np.float32)
    pose_world = np.zeros((frames, 33, 3), np.float32)
    hand = np.zeros((frames, 21, 3), np.float32)
    hand_world = np.zeros((frames, 21, 3), np.float32)
    for i in range(frames):
        pose[i, :, :2] = 0.5
        pose[i, :, 3] = 0.99
        pose_world[i, 11] = [0.15, 0.0, 0.0]
        pose_world[i, 12] = [-0.15, 0.0, 0.0]
        move = np.array([steps[i], 0]) if kind == "a" else np.array([0, steps[i]])
        pose_world[i, 16, :2] = [-0.2, 0.1] + move
        pose_world[i, 15, :2] = [0.2, 0.1]
        pose_world[i, 14, :2] = [-0.25, 0.05]
        pose_world[i, 13, :2] = [0.25, 0.05]
        for j in range(21):
            hand[i, j] = [0.35 + 0.01 * (j % 5), 0.6 - 0.01 * (j // 5), 0]
            hand_world[i, j] = [0.01 * (j % 5), 0.012 * (j // 5), 0.002 * j] + rng.normal(0, 0.001, 3)
        hand[i, :, :2] += offset + move * 0.5
    pose_world += rng.normal(0, 0.002, pose_world.shape).astype(np.float32)
    return {
        "timestamps_ms": (np.arange(frames) * 50).astype(np.float32),
        "pose": pose, "pose_world": pose_world, "pose_mask": np.ones(frames, np.uint8),
        "left_hand": np.zeros_like(hand), "left_hand_world": np.zeros_like(hand_world),
        "left_mask": np.zeros(frames, np.uint8),
        "right_hand": hand, "right_hand_world": hand_world, "right_mask": np.ones(frames, np.uint8),
        "meta": {"schema_version": "2.0", "frame_count": frames},
    }


def write_npz(path: Path, arrays: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {k: v for k, v in arrays.items() if k != "meta"}
    data["meta"] = np.frombuffer(json.dumps(arrays["meta"]).encode(), dtype=np.uint8)
    # `np.savez` writes `<key>.npy` files in a zip, as the TypeScript writer does.
    with open(path, "wb") as f:
        np.savez(f, **data)


def write_release(folder: Path, persons: int = 6, per_person: int = 3) -> None:
    """A release with two signs. Each person has `per_person` recordings of each sign."""
    signs = [{"id": "sign-a", "slug": "a", "name": "A"}, {"id": "sign-b", "slug": "b", "name": "B"}]
    rows = []
    for person in range(persons):
        for sign, kind in zip(signs, "ab"):
            for n in range(per_person):
                path = f"{sign['slug']}/person{person}/{n + 1:02d}.npz"
                write_npz(folder / path, make_arrays(kind, person, seed=n))
                rows.append({"path": path, "sign_id": sign["id"], "sign_slug": sign["slug"], "uuid": f"person{person}"})
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "signs.json").write_text(json.dumps({"signs": signs}), encoding="utf-8")
    with open(folder / "index.csv", "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["path", "sign_id", "sign_slug", "uuid"])
        writer.writeheader()
        writer.writerows(rows)
