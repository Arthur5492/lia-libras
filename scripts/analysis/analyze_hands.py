"""Compara os rotulos de mao do .npz com o pulso mais proximo da pose.

Uso: python -I analyze_hands.py <pasta_com_npz>
Nao usa pickle e nao imprime nada que identifique pessoas.
"""
import collections
import sys
from pathlib import Path

import numpy as np

LEFT_WRIST, RIGHT_WRIST, L_SHOULDER, R_SHOULDER = 15, 16, 11, 12
root = Path(sys.argv[1])
files = sorted(root.rglob("*.npz"))

t = collections.Counter()
frames_shape = collections.Counter()
active = collections.defaultdict(collections.Counter)
person_active = collections.defaultdict(collections.Counter)
both_rate_by_sign = collections.defaultdict(list)
dist_norm = []
rec_with_flip = rec_with_mismatch = 0
errors = 0

for path in files:
    try:
        with np.load(path, allow_pickle=False) as z:
            pose, pm = z["pose"], z["pose_mask"].astype(bool)
            lh, lm = z["left_hand"], z["left_mask"].astype(bool)
            rh, rm = z["right_hand"], z["right_mask"].astype(bool)
    except Exception:
        errors += 1
        continue
    sign, person = path.relative_to(root).parts[:2]
    n = len(pose)
    frames_shape[n] += 1
    t["recordings"] += 1
    t["frames"] += n
    t["frames_pose"] += int(pm.sum())
    t["frames_left_slot"] += int(lm.sum())
    t["frames_right_slot"] += int(rm.sum())
    t["frames_both"] += int((lm & rm).sum())
    t["frames_no_hand"] += int((~lm & ~rm).sum())
    both_rate_by_sign[sign].append(float((lm & rm).mean()))

    flipped = mismatched = False
    assigned = {LEFT_WRIST: [], RIGHT_WRIST: []}
    for i in range(n):
        if not pm[i]:
            if lm[i] or rm[i]:
                t["hand_frames_without_pose"] += 1
            continue
        lw, rw = pose[i, LEFT_WRIST, :2], pose[i, RIGHT_WRIST, :2]
        scale = np.linalg.norm(pose[i, L_SHOULDER, :2] - pose[i, R_SHOULDER, :2]) or 1.0
        nearest = []
        for slot, hand, mask in (("L", lh, lm), ("R", rh, rm)):
            if not mask[i]:
                continue
            w = hand[i, 0, :2]
            dl, dr = np.linalg.norm(w - lw), np.linalg.norm(w - rw)
            to = LEFT_WRIST if dl <= dr else RIGHT_WRIST
            nearest.append(to)
            dist_norm.append(min(dl, dr) / scale)
            assigned[to].append((i, w))
            key = f"slot{slot}_near_{'poseL' if to == LEFT_WRIST else 'poseR'}"
            t[key] += 1
            if (slot == "L") != (to == LEFT_WRIST):
                mismatched = True
        if len(nearest) == 2 and nearest[0] == nearest[1]:
            t["both_hands_same_wrist"] += 1

    # mesma mao fisica saltando de canal: so um canal em frames seguidos,
    # o canal muda e a posicao quase nao muda
    for i in range(1, n):
        for a, am, b, bm in ((lh, lm, rh, rm), (rh, rm, lh, lm)):
            if am[i - 1] and not bm[i - 1] and bm[i] and not am[i]:
                if np.linalg.norm(a[i - 1, 0, :2] - b[i, 0, :2]) < 0.05:
                    t["slot_jumps"] += 1
                    flipped = True
    rec_with_flip += flipped
    rec_with_mismatch += mismatched

    # mao ativa pelo pulso da pose: quem mais se move
    motion = {}
    for wrist, pts in assigned.items():
        if len(pts) >= 2:
            arr = np.array([p for _, p in pts])
            motion[wrist] = (len(pts), float(np.linalg.norm(np.diff(arr, axis=0), axis=1).sum()))
    if motion:
        if len(motion) == 2 and min(v[0] for v in motion.values()) >= n * 0.5:
            winner = max(motion, key=lambda k: motion[k][1])
        else:
            winner = max(motion, key=lambda k: motion[k][0])
        name = "pose_left" if winner == LEFT_WRIST else "pose_right"
        active[sign][name] += 1
        person_active[person][name] += 1

print("arquivos:", len(files), "erros:", errors, "frames por gravacao:", dict(frames_shape))
for k in sorted(t):
    print(f"  {k}: {t[k]}")
print("gravacoes com rotulo diferente do pulso:", rec_with_mismatch)
print("gravacoes com salto de canal:", rec_with_flip)
if dist_norm:
    d = np.array(dist_norm)
    print("distancia pulso da mao -> pulso da pose (em larguras de ombro): "
          f"mediana={np.median(d):.3f} p95={np.percentile(d, 95):.3f} max={d.max():.3f}")
tot_people = collections.Counter()
print("mao ativa por pessoa (anonimo):")
for i, (_, c) in enumerate(sorted(person_active.items(), key=lambda kv: -sum(kv[1].values()))):
    print(f"  pessoa{i}: esq={c['pose_left']} dir={c['pose_right']}")
mixed = sum(1 for c in active.values() if c["pose_left"] and c["pose_right"])
print(f"sinais com as duas maos ativas em gravacoes diferentes: {mixed}/{len(active)}")
top = sorted(((np.mean(v), s) for s, v in both_rate_by_sign.items()), reverse=True)[:6]
print("sinais com mais frames de duas maos:", [(s, round(float(m), 2)) for m, s in top])
