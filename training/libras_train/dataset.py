"""Choose the signs, split by person and build the arrays for the model."""
from __future__ import annotations

import random
from dataclasses import dataclass

import numpy as np

from .data import Recording
from .features import features, mirror, resample


def choose_signs(recordings: list[Recording], minimum: int, min_persons: int = 2) -> list[str]:
    """Sign ids that have enough recordings from enough persons. The list is sorted, so the class order is fixed."""
    count: dict[str, int] = {}
    persons: dict[str, set] = {}
    for r in recordings:
        count[r.sign_id] = count.get(r.sign_id, 0) + 1
        persons.setdefault(r.sign_id, set()).add(r.uuid)
    return sorted(s for s in count if count[s] >= minimum and len(persons[s]) >= min_persons)


def split_by_person(persons: list[str], seed: int = 42) -> dict[str, str]:
    """Give each person to one set: train, val or test. A person is never in two sets.

    A model that sees a person in training and in test seems better than it is, because the same person
    makes almost the same movement each time. At least 3 persons are necessary.
    """
    unique = sorted(set(persons))
    if len(unique) < 3:
        raise ValueError(f"Need at least 3 persons to split by person. The release has {len(unique)}.")
    random.Random(seed).shuffle(unique)
    held = max(1, round(len(unique) * 0.2))
    assignment = {}
    for i, person in enumerate(unique):
        assignment[person] = "test" if i < held else "val" if i < 2 * held else "train"
    return assignment


@dataclass
class Split:
    x: np.ndarray  # (N, frames, FEATURE_SIZE)
    y: np.ndarray  # (N,) class numbers
    x_mirrored: np.ndarray  # The same recordings as if the other hand made the sign.
    persons: np.ndarray  # (N,)


def build(recordings: list[Recording], sign_ids: list[str], frames: int, assignment: dict[str, str]) -> dict[str, Split]:
    index = {sign_id: i for i, sign_id in enumerate(sign_ids)}
    parts: dict[str, dict[str, list]] = {k: {"x": [], "y": [], "xm": [], "p": []} for k in ("train", "val", "test")}
    for r in recordings:
        if r.sign_id not in index:
            continue
        part = parts[assignment[r.uuid]]
        small = resample(r.arrays, frames)
        part["x"].append(features(small))
        part["xm"].append(features(mirror(small)))
        part["y"].append(index[r.sign_id])
        part["p"].append(r.uuid)
    shape = (0, frames, features_size())
    return {
        name: Split(
            np.asarray(p["x"], dtype=np.float32).reshape(-1, *shape[1:]),
            np.asarray(p["y"], dtype=np.int64),
            np.asarray(p["xm"], dtype=np.float32).reshape(-1, *shape[1:]),
            np.asarray(p["p"]),
        )
        for name, p in parts.items()
    }


def features_size() -> int:
    from .features import FEATURE_SIZE

    return FEATURE_SIZE
