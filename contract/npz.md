# Contract: `.npz` recordings and the hand rule

The `.npz` file is the technical source of truth for each recording. Firestore is only an index. The code is in `shared/capture.ts`, `shared/hands.ts` and `server/npz.ts`.

## Path in the bucket
`<sign_slug>/<uuid>/<NN>.npz`

- `sign_slug`: slug of the sign in the catalog (for example, `letra-a`).
- `uuid`: random identifier of the person (UUID v4). This is the only personal data in the bucket.
- `NN`: recording index with two digits. The first index is `01`.
- Do **not** change the slug of a sign after it has recordings, because the folder does not change. To rename a sign, change only `name`.

## Format (schema 2.0)
The file keeps the raw frames from the camera, not resampled. `n` is the frame count, from 15 to 150. Training does the resampling.

Open with `np.load(path, allow_pickle=False)`.

| Key | Type | Shape | Content |
|---|---|---|---|
| `meta` | uint8 | (bytes,) | UTF-8 JSON. Read with `json.loads(bytes(z["meta"]))` |
| `timestamps_ms` | float32 | (n,) | Time of each frame from the first frame. Starts at 0 and always increases. Maximum 4000 |
| `pose` | float32 | (n, 33, 4) | BlazePose x, y, z, visibility, in image coordinates |
| `pose_world` | float32 | (n, 33, 3) | BlazePose world landmarks x, y, z, in meters, origin at the hips |
| `pose_mask` | uint8 | (n,) | 1 if the frame has a pose |
| `left_hand`, `right_hand` | float32 | (n, 21, 3) | Hand Landmarker x, y, z, in image coordinates, in the channel from the wrist rule |
| `left_hand_world`, `right_hand_world` | float32 | (n, 21, 3) | Hand world landmarks, in meters, origin at the hand center |
| `left_mask`, `right_mask` | uint8 | (n,) | 1 if the channel has a hand |
| `hand_labels` | uint8 | (n, 2) | Original detector label in each channel (0 = no hand, 1 = `Left`, 2 = `Right`). For audits only |
| `hand_scores` | float32 | (n, 2) | Detector confidence for that label |

`meta` fields: `schema_version` (`"2.0"`), `capture_version`, `sign_id`, `video_idx`, `frame_count`, `duration_ms`, `video_width`, `video_height`.

Conventions:
- Image x and y are normalized to the image **without the mirror**. The screen mirror is only visual. x increases to the right of the camera image.
- Image coordinates can be outside [0, 1] for points outside the image.
- Image `z` is relative. Do not use it as a real distance. Use the world landmarks for geometry.
- A frame with mask 0 has data of zero. Values are always finite.
- The API never discards a hand because two hands have the same detector label.

## Hand rule (channel by pose wrist)
The capture and the API apply this rule before the save. Inference applies it to live data. The site and the API use the same code. The rule is idempotent.

Input per frame: the pose (with its mask) and up to two detected hands. Channel L = left pose wrist (landmark 15). Channel R = right pose wrist (landmark 16). Measure distances in x and y, in image coordinates, from the hand wrist (landmark 0).

When the frame has a pose:
1. One hand: put it in the channel of the nearest wrist. If the distances are equal, use L.
2. Two hands `a` and `b`: if `d(a,L) + d(b,R) <= d(a,R) + d(b,L)`, then `a → L` and `b → R`. If not, use the opposite. The two hands never share a channel.

When the frame has no pose, keep the continuity:
1. For each channel, keep the last known wrist position.
2. One hand: put it in the channel with the nearest last position. If there is no history, keep the channel from the detector.
3. Two hands: use the same lowest sum as above, with the last positions. If one channel has no history, keep the channels from the detector.

The image, world, label and score data of a hand always move together.

"L" and "R" follow BlazePose, which names the sides of the person. The rule does not need these names to be correct. It only needs to be stable.

## Mirror (training only)
Use this to teach the model to accept each hand:
- `x' = 1 - x` for image coordinates, and `x' = -x` for world coordinates.
- Swap the hand channels (L ↔ R) and their masks.
- Swap the left/right pose pairs: 1↔4, 2↔5, 3↔6, 7↔8, 9↔10, 11↔12, 13↔14, 15↔16, 17↔18, 19↔20, 21↔22, 23↔24, 25↔26, 27↔28, 29↔30, 31↔32.

## Active hand
Calculate it for each recording, after the wrist rule. If each channel has a hand in at least half of the frames, use the channel with more wrist movement. If not, use the channel with more frames. Values: `left`, `right` or `unknown` (no hand). Use it as extra data only. For static signs the passive hand is usually visible, and the result is not reliable.

## Validation on upload
- Reject (do not save): wrong frame count or shapes, values that are not finite, bad timestamps, a sign that is not in the catalog or is not active, a pose in less than 80% of the frames (`low_pose_rate`), or a hand in less than 30% of the frames (`low_any_hand_rate`).
- Warn (save with a flag): comparison with the reference profile of the sign. The profiles use the sign UUID as key.
