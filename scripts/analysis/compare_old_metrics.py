"""Compare the new API metrics and replay data with the two old apps, on real recordings.

Usage: python compare_old_metrics.py <repository_root> <folder_with_npz>
The old projects must be in the repository root, as on the development computer.
"""
import importlib.util
import os
import pathlib
import sys

root, npz_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
os.environ["LIA_DRY_RUN"] = "1"
sys.path.insert(0, str(root))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


old_pub = load("old_pub", root / "lia_libras_dataset/src/storage.py")
sys.modules.setdefault("src", type(sys)("src"))
sys.modules["src.admin"] = type(sys)("src.admin")
old_ref = load("old_ref", root / "adm_lia_libras_dataset/src/reference_profiles.py")

from backend.libras_api.metrics import recording_metrics  # noqa: E402
from backend.libras_api.recording import read_npz, replay_payload  # noqa: E402

keys = ["pose_rate", "left_hand_rate", "right_hand_rate", "any_hand_rate", "both_hands_rate", "motion_score"]
worst = {k: 0.0 for k in keys}
n = replay_ok = 0
for f in sorted(npz_dir.rglob("*.npz")):
    data = read_npz(f.read_bytes())
    new = recording_metrics(data)
    pub = old_pub._recording_metrics(data["pose_mask"], data["left_mask"], data["right_mask"], data["left_hand"], data["right_hand"])
    ref = old_ref._recording_metrics(data)
    for k in keys:
        worst[k] = max(worst[k], abs(new[k] - pub[k]))
        if k in ref:
            worst[k] = max(worst[k], abs(new[k] - ref[k]))
    old_replay = old_pub._replay_payload(data, "x", 1)
    new_replay = replay_payload(data)
    replay_ok += all(old_replay[k] == new_replay[k] for k in ("pose", "left_hand", "right_hand", "pose_mask", "left_mask", "right_mask", "fps"))
    n += 1
print("recordings", n)
print("largest difference per metric", {k: float(v) for k, v in worst.items()})
print("replay identical to the old app", replay_ok, "of", n)
