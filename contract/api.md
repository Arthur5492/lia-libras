# Contract: API

Hono app in `server/app.ts`. `api/index.ts` is the Vercel entry point.

## Authentication
`Authorization: Bearer <Firebase ID token>`. Routes that need a profile need a registration first (`POST /api/me`).

| Access level | Who |
|---|---|
| Public | All persons, with CDN cache |
| Sign-in | Valid token, also without a profile |
| Profile | Token and a profile in `users/{uid}` |
| Review | `trusted`, `expert` or role `admin` |
| Admin | Role `admin` |

## Routes

| Method and path | Access | Use |
|---|---|---|
| `GET /api/health` | Public | API status |
| `GET /api/signs` | Public | Catalog of active signs |
| `GET /api/stats` | Public | Totals and ranking (only persons who opted in) |
| `GET /api/usernames/{name}/available` | Sign-in | Check if the username is free |
| `POST /api/me` | Sign-in | Registration: `username`, `consent_version`, `show_in_ranking` |
| `GET /api/me` | Profile | Profile, with `sign_recordings` |
| `PATCH /api/me` | Profile | Only `show_in_ranking` |
| `GET /api/collect/next?count=5` | Profile | Signs for the next collection session: not complete for the person, fewest recordings first |
| `POST /api/recordings` | Profile | Upload (format below). 201 for a new recording, 200 for a retry |
| `GET /api/me/recordings` | Profile | Own recordings |
| `DELETE /api/me/recordings/{id}` | Profile | Delete an own recording |
| `GET /api/recordings/{id}/replay` | Profile | Landmarks for the replay (author or reviewer) |
| `GET /api/review/recordings` | Review | `status` is necessary. Use a maximum of one filter: `sign_id`, `trust_level`, `flag` or `username`. Also `cursor`, `limit` |
| `PATCH /api/review/recordings` | Review | `{"updates": [{"id", "status": "accepted" \| "rejected" \| "pending"}]}`, maximum 50 |
| `GET /api/admin/users` | Admin | Paginated list, or `?username=` |
| `PATCH /api/admin/users/{uid}` | Admin | `trust_level`, `role` |
| `GET /api/admin/signs` | Admin | Catalog with inactive signs |
| `POST /api/admin/signs` | Admin | `name`, `video_url`, `sign_metadata`, `order` |
| `PATCH /api/admin/signs/{id}` | Admin | Same fields and `active`. The slug does not change |
| `PUT /api/admin/sign-metadata-schema` | Admin | New metadata schema |
| `GET /api/admin/reference-profiles` | Admin | Current profiles |
| `POST /api/admin/reference-profiles/rebuild` | Admin | Build the profiles again from the reference recordings |

## Upload
The arrays are base64 text of little-endian bytes: float32 for coordinates, timestamps and scores, uint8 for masks and labels. `shared/capture.ts` has `encodeCapture` and `decodeCapture`. See contract/npz.md for the shapes.

```json
{
  "client_id": "uuid made on the device, the same for each retry",
  "sign_id": "uuid of the sign",
  "capture_version": "pwa-0.1.0",
  "meta": {"duration_ms": 2000, "video_width": 640, "video_height": 480},
  "frame_count": 47,
  "timestamps_ms": "base64 float32 (n)",
  "pose": "base64 float32 (n*33*4)",
  "pose_world": "base64 float32 (n*33*3)",
  "pose_mask": "base64 uint8 (n)",
  "left_hand": "base64 float32 (n*21*3)",
  "left_hand_world": "base64 float32 (n*21*3)",
  "left_mask": "base64 uint8 (n)",
  "right_hand": "...", "right_hand_world": "...", "right_mask": "...",
  "hand_labels": "base64 uint8 (n*2)",
  "hand_scores": "base64 float32 (n*2)"
}
```

The server applies the hand rule again, validates the data and writes the `.npz` file. The response contains the recording and the replay data.

## Errors
The body is always `{"code": "...", ...}`. The interface changes the code into a message.

| HTTP | Codes |
|---|---|
| 401 | `missing_token`, `invalid_token` |
| 403 | `not_registered`, `reviewer_only`, `admin_only`, `cannot_review_own` |
| 404 | `recording_not_found`, `recording_file_missing`, `user_not_found`, `sign_not_found` |
| 409 | `already_registered`, `username_taken`, `busy_retry` (try again), `sign_complete`, `upload_in_progress`, `client_id_conflict`, `slug_taken`, `cannot_remove_own_admin` |
| 422 | `invalid_username`, `blocked_username`, `consent_required`, `unknown_sign`, `invalid_client_id`, `low_quality` (with `validation_flags` and `metrics`), `invalid_json`, `invalid_frame_count`, `invalid_<array>`, `invalid_<array>_shape`, `invalid_<array>_values`, `invalid_status`, `too_many_filters`, `invalid_cursor`, `invalid_batch_size`, `invalid_sign`, `invalid_role`, `invalid_trust_level`, `invalid_metadata_schema`, `invalid_sign_metadata` |
| 500 | `internal_error` |
| 502 | `storage_error` |

## Tests
```bash
npx firebase emulators:exec --only auth,firestore --project demo-libras "npm test"
```
Without the emulators, only the domain tests run (`npm test`).
