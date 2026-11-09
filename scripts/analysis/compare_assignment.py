"""Compare channel stability: detector label against pose wrist.

There is no ground truth. The test uses a physical rule: a hand does not
jump far between two consecutive frames at 15 fps. The script counts the
jumps per channel for each method.
Usage: python -I compare_assignment.py <folder_with_npz>
"""
import collections
import sys
from pathlib import Path

import numpy as np

LW, RW, LS, RS = 15, 16, 11, 12
THRESHOLDS = (0.5, 1.0)  # In shoulder widths per frame.


def by_pose(i, pose, hands):
    """Return {channel: wrist_xy}. For two hands, use the permutation with the lowest cost."""
    lw, rw = pose[i, LW, :2], pose[i, RW, :2]
    if len(hands) == 2:
        a, b = hands
        direct = np.linalg.norm(a - lw) + np.linalg.norm(b - rw)
        crossed = np.linalg.norm(a - rw) + np.linalg.norm(b - lw)
        return {"L": a, "R": b} if direct <= crossed else {"L": b, "R": a}
    if len(hands) == 1:
        a = hands[0]
        return {"L": a} if np.linalg.norm(a - lw) <= np.linalg.norm(a - rw) else {"R": a}
    return {}


jumps = {m: collections.Counter() for m in ("label", "wrist")}
recs = {m: collections.Counter() for m in ("label", "wrist")}
changed = total = far = n_recs = 0
for path in sorted(Path(sys.argv[1]).rglob("*.npz")):
    with np.load(path, allow_pickle=False) as z:
        pose, lh, lm, rh, rm = z["pose"], z["left_hand"], z["left_mask"].astype(bool), z["right_hand"], z["right_mask"].astype(bool)
    n_recs += 1
    prev = {"label": {}, "wrist": {}}
    hit = {m: set() for m in prev}
    for i in range(len(pose)):
        scale = np.linalg.norm(pose[i, LS, :2] - pose[i, RS, :2]) or 1.0
        labeled = {}
        if lm[i]:
            labeled["L"] = lh[i, 0, :2]
        if rm[i]:
            labeled["R"] = rh[i, 0, :2]
        assigned = by_pose(i, pose, list(labeled.values()))
        total += len(labeled)
        for ch, w in labeled.items():
            if ch not in assigned or not np.allclose(assigned[ch], w):
                changed += 1
            d = min(np.linalg.norm(w - pose[i, LW, :2]), np.linalg.norm(w - pose[i, RW, :2])) / scale
            far += d > 1.0
        for method, cur in (("label", labeled), ("wrist", assigned)):
            for ch, w in cur.items():
                if ch in prev[method]:
                    step = np.linalg.norm(w - prev[method][ch]) / scale
                    for th in THRESHOLDS:
                        if step > th:
                            jumps[method][th] += 1
                            hit[method].add(th)
            prev[method] = cur
    for m in hit:
        for th in hit[m]:
            recs[m][th] += 1

print(f"recordings={n_recs} hands_in_frames={total}")
print(f"channels changed by the wrist method: {changed} ({changed/total:.1%})")
print(f"hand more than 1 shoulder width from both wrists: {far} ({far/total:.2%})")
for th in THRESHOLDS:
    for m in ("label", "wrist"):
        print(f"jump > {th} shoulder/frame | {m}: {jumps[m][th]} jumps in {recs[m][th]} recordings")
