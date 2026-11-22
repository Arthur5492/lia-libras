"""Read a release folder. Make it with: npm run release -- download latest <folder>."""
from __future__ import annotations

import csv
import json
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class Recording:
    sign_id: str
    slug: str
    uuid: str
    path: str
    arrays: dict[str, np.ndarray]


PER_FRAME = (
    "timestamps_ms", "pose", "pose_world", "pose_mask",
    "left_hand", "left_hand_world", "left_mask",
    "right_hand", "right_hand_world", "right_mask",
)


def load_npz(path: Path) -> dict[str, np.ndarray]:
    """Read one recording. See contract/npz.md for the format."""
    with np.load(path, allow_pickle=False) as z:
        missing = [k for k in PER_FRAME if k not in z.files]
        if missing:
            raise ValueError(f"{path}: missing keys {missing}")
        arrays = {k: z[k] for k in PER_FRAME}
        arrays["meta"] = json.loads(bytes(z["meta"]).decode("utf-8"))
    if arrays["meta"].get("schema_version") != "2.0":
        raise ValueError(f"{path}: unsupported schema {arrays['meta'].get('schema_version')}")
    return arrays


def load_release(folder: str | Path) -> tuple[list[Recording], list[dict]]:
    """Return the recordings of the release and its sign catalog. A missing file is skipped, with a warning."""
    folder = Path(folder)
    signs = json.loads((folder / "signs.json").read_text(encoding="utf-8"))["signs"]
    recordings: list[Recording] = []
    skipped = 0
    with open(folder / "index.csv", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            path = folder / row["path"]
            if not path.exists():
                skipped += 1
                continue
            recordings.append(
                Recording(row["sign_id"], row["sign_slug"], row["uuid"], row["path"], load_npz(path))
            )
    if skipped:
        warnings.warn(f"{skipped} recording(s) of the index are not in the folder and are skipped.")
    return recordings, signs
