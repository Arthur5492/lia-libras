# Contract: `.npz` recordings and the hand rule

The `.npz` file is the technical source of truth for each recording. Firestore is only an index. Checked against the 291 recordings in the bucket on 2026-11-09.

## Path in the bucket
`<sign_slug>/<uuid>/<NN>.npz`

- `sign_slug`: slug of the sign in the catalog (for example, `letra-a`). All current recordings use this.
- `uuid`: random identifier of the person (UUID v4). This is the only personal data in the bucket.
- `NN`: recording index with two digits. The first index is `01`.
- Do **not** change the slug of a sign after it has recordings, because the folder does not change. To rename a sign, change only `name`.
- Readers must accept the old formats that the old code also accepts: a folder with the id in place of the slug, and a name without the leading zero (`1.npz`). No file uses these formats now. For the migration, use the `video_path` from the manifest.

## Version 1.0 (all current recordings)
Always open with `np.load(..., allow_pickle=False)`.

| Key | Type | Shape | Content |
|---|---|---|---|
| `schema_version` | str | () | `"1.0"` |
| `sinal_id` | str | () | UUID of the sign in the catalog |
| `video_idx` | int16 | () | Same as `NN` in the file name |
| `frame_count` | int16 | () | Saved frames (always 30) |
| `raw_frame_count` | int16 | () | Captured frames before resampling (for example, 15 to 35) |
| `duration_ms` | int32 | () | Real capture duration (2000 to 2151 now) |
| `target_fps` | float32 | () | 15 |
| `target_frame_count` | int16 | () | 30 |
| `record_duration_ms` | int32 | () | 2000 |
| `video_width`, `video_height` | int16 | () | Camera resolution (640 × 480 now) |
| `pose` | float32 | (30, 33, 4) | BlazePose x, y, z, visibility |
| `pose_mask` | uint8 | (30,) | 1 if the frame has a pose |
| `left_hand`, `right_hand` | float32 | (30, 21, 3) | Hand Landmarker x, y, z |
| `left_mask`, `right_mask` | uint8 | (30,) | 1 if the channel has a hand |

Conventions:
- x and y are normalized to the image **without the mirror**. The screen mirror is only visual. x increases to the right of the camera image.
- Coordinates can be outside [0, 1]. Points outside the image, such as the legs, go up to y = 2.4.
- `z` is relative. Do not use it as a real distance.
- A frame with mask 0 has coordinates of zero. No current file has NaN values.
- In 1.0, the channel of a hand comes from the detector label (`Left`/`Right`). If two hands get the same label, the second hand replaces the first, and one hand is lost.

## Version 1.1 (new PWA recordings)
Same keys and shapes as 1.0, with these changes:
- `schema_version = "1.1"`.
- The channels come from the wrist rule (below). The API does not discard a hand because of a repeated label.
- New key `hand_labels`: uint8 (30, 2), with the original detector label in each channel (0 = no hand, 1 = `Left`, 2 = `Right`). Use it for audits only.
- New key `capture_version`: str, version of the app that made the recording.

Do **not** write 1.0 files again, because the bucket has no versions. Apply the wrist rule also when you read a file. For 1.1 files, the rule changes nothing.

## Hand rule (channel by pose wrist)
Use this rule when you read any version, for training and for inference. Python and TypeScript must give the same result on the test vectors.

Input per frame: the pose (with its mask) and up to two detected hands. Channel L = left pose wrist (landmark 15). Channel R = right pose wrist (landmark 16). Measure distances in x and y, in image coordinates, from the hand wrist (landmark 0).

When the frame has a pose:
1. One hand: put it in the channel of the nearest wrist. If the distances are equal, use L.
2. Two hands `a` and `b`: if `d(a,L) + d(b,R) <= d(a,R) + d(b,L)`, then `a → L` and `b → R`. If not, use the opposite. The two hands never share a channel.

When the frame has no pose, keep the continuity:
1. For each channel, keep the last known wrist position.
2. One hand: put it in the channel with the nearest last position. If there is no history, keep the channel from the file.
3. Two hands: use the same lowest sum as above, with the last positions. If one channel has no history, keep the channels from the file.

"L" and "R" follow BlazePose, which names the sides of the person. The rule does not need these names to be correct. It only needs to be stable.

## Mirror (training only)
Use this to teach the model to accept each hand:
- `x' = 1 - x` for the pose and the hands.
- Swap the hand channels (L ↔ R) and their masks.
- Swap the left/right pose pairs: 1↔4, 2↔5, 3↔6, 7↔8, 9↔10, 11↔12, 13↔14, 15↔16, 17↔18, 19↔20, 21↔22, 23↔24, 25↔26, 27↔28, 29↔30, 31↔32.

## Active hand
Calculate it for each recording, after the wrist rule. If each channel has a hand in at least half of the frames, use the channel with more wrist movement. If not, use the channel with more frames. Values: `left`, `right` or `unknown` (no hand). Use it as extra data only. For static signs, such as the letters U and V, the passive hand is visible in approximately 90% of the frames, and the result is not reliable.

## Validation on upload
- Reject (do not save): `frame_count != 30`, shapes different from the table, values that are not finite, a `sinal_id` that is not in the catalog or is not active, a pose in less than 80% of the frames (`low_pose_rate`), or a hand in less than 30% of the frames (`low_any_hand_rate`).
- Warn (save with a flag): comparison with the reference profile of the sign, as in the old code.

The current reference profiles use the key `amor` (slug), but the recordings use the sign UUID. Thus, the comparison never occurred: no manifest row of the 300 has a flag. The migration changes the profile keys to the UUID.
