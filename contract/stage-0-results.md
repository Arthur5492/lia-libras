# Stage 0: risk test results

Date: 2026-11-09. Scripts are in `scripts/analysis/` and `training/tools/`.

## Summary

| Risk | Result | Decision |
|---|---|---|
| Hand labels | Labels are not swapped in a systematic way. 2.2% do not agree with the pose | Assign the hands by pose wrist |
| Bucket in the browser | The `resolve` URL works. The S3 gateway refuses anonymous access | Download public data with `resolve` |
| Model export | TensorFlow.js works and keeps the predictions | Use TensorFlow.js. ONNX is not necessary |
| Python API | The size is below the limit. CPU per upload is low | Keep Python. Measure on Vercel |
| Public bucket | The bucket is public, and `users.csv` is visible | The owner decided to keep it as it is |
| Real Vercel | Not tested. It needs the account | Open |
| Low-cost phones | Not tested. It needs real devices | Open |

## Real dataset on 2026-11-09
291 recordings, 8 persons, 29 signs. Each recording has 30 frames and is approximately 26 KB. The distribution is not equal: the recordings per person are 120, 62, 33, 30, 24, 10, 8 and 4. This is not sufficient for a general model, or for a good split by person.

## Hands
There are 14,240 hand detections in 8,730 frames. All frames have a pose.

| Measure | Value |
|---|---|
| Label agrees with the nearest wrist | 13,927 (97.8%) |
| Label does not agree with the wrist | 313 (2.2%), in 106 recordings (36%) |
| Two hands nearest to the same wrist | 50 frames |
| Same hand jumps channel | 21 times, in 17 recordings |
| Hand more than 1 shoulder width from both wrists | 127 (0.89%) |

There is no ground truth. The test uses a physical rule: a hand does not jump far between two consecutive frames.

| Jump between frames | Detector label | Pose wrist |
|---|---|---|
| More than 0.5 shoulder width | 188 jumps, in 92 recordings | 19 jumps, in 12 recordings |
| More than 1.0 shoulder width | 172 jumps, in 84 recordings | 13 jumps, in 7 recordings |

**Rule:** put one hand in the channel of the nearest wrist. For two hands, use the pair with the lowest total distance. Thus, two hands never share a channel.

**Test limits:**
- The test does not measure lost hands. When the detector gives the same label to two hands, the old app does not save the second hand (`recorder.js:1104-1105`). The new capture must keep the two hands.
- The data has no frames without a pose.
- The test does not show which method is correct in each frame. It only shows which method is more stable.

**Active hand:** all 8 persons have recordings with each side, and 22 of 29 signs show each side. This is only an indication. The rule is not reliable for static signs: letters such as U and V show two hands in approximately 90% of the frames, because the passive hand is usually visible. Do not use `active_hand` as truth for static signs.

## Bucket
- The Hub API shows `private: false`. The file list and the files are available without authentication.
- `https://huggingface.co/buckets/<owner>/<bucket>/resolve/<file>` redirects to the CDN. The two responses have CORS headers that let the browser read the file. The test used `curl` with an `Origin` header. Do the test again in a real browser.
- On 2026-11-09 the owner decided to keep the bucket public, with `users.csv`, until the migration (stage 9) removes the CSV files.
- `https://s3.hf.co/...` gives 403 without credentials. Use the gateway for API writes, not for anonymous reads.

## Model export
`lstm_libras/models/v2/model.h5` (input 20 × 196, 10 classes) became `model.json` and weights, approximately 327 KB in total.

| Comparison with Keras 2.10 | Result |
|---|---|
| Samples with the same class | 8 of 8, with one sample of zeros |
| Largest probability difference | 4.47e-8 |
| Time per inference, plain JS on a PC | 12 ms (a phone will be slower; not measured) |

Conversion environment, separate from training: Python 3.11, `tensorflowjs==4.22.0`, `tf-keras`, `setuptools<81`. On Windows, the converter fails when it imports `tensorflow_decision_forests`. `training/tools/convert_h5.py` prevents this import.

## Python API
Measured on the local computer with Linux packages. This does not replace a measurement on Vercel.

| Measure | Value |
|---|---|
| Packages with `numpy`, `fastapi`, `firebase-admin`, `huggingface_hub` and `boto3` | 165 MB (140 MB without `boto3`). The limit is 500 MB |
| JSON body for a 30-frame recording | 124 KB |
| CPU to read the JSON and make the `.npz` | approximately 10 ms, without network and cold start |
| Imports, second run | `firebase_admin` approximately 1.8 s, `fastapi` approximately 1.2 s, `numpy` approximately 0.8 s (overlapping measurements, on Windows) |

Monitor the cold start. With 4 h of CPU per month, the cold start costs more than the upload work.

## Open items
1. Deploy a test on Vercel. Measure the real cold start and CPU.
2. Measure MediaPipe and inference fps on a low-cost phone and on iOS.
