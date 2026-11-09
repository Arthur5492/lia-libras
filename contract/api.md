# Contract: API

FastAPI in `backend/libras_api/`. When the API runs, the interactive documentation is at `/api/docs`.

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
| `POST /api/recordings` | Profile | Upload (format below). 201 for a new recording, 200 for a retry |
| `GET /api/me/recordings` | Profile | Own recordings |
| `DELETE /api/me/recordings/{id}` | Profile | Delete an own recording |
| `GET /api/recordings/{id}/replay` | Profile | Landmarks for the replay (author or reviewer) |
| `GET /api/review/recordings` | Review | `status` is necessary. Use a maximum of one filter: `sign_id`, `trust_level`, `flag` or `username`. Also `cursor`, `limit` |
| `PATCH /api/review/recordings` | Review | `{"updates": [{"id", "status": "accepted" \| "rejected" \| "pending"}]}`, maximum 50 |
| `GET /api/admin/users` | Admin | Paginated list, or `?username=` |
| `PATCH /api/admin/users/{uid}` | Admin | `trust_level`, `role` |
| `GET /api/admin/legacy-users` | Admin | Accounts from the old app |
| `POST /api/admin/legacy-users/{uuid}/link` | Admin | `{"uid"}`: link the old account to a profile without recordings |
| `GET /api/admin/signs` | Admin | Catalog with inactive signs |
| `POST /api/admin/signs` | Admin | `name`, `video_url`, `sign_metadata`, `order` |
| `PATCH /api/admin/signs/{id}` | Admin | Same fields and `active`. The slug does not change |
| `PUT /api/admin/sign-metadata-schema` | Admin | New metadata schema |
| `GET /api/admin/reference-profiles` | Admin | Current profiles |
| `POST /api/admin/reference-profiles/rebuild` | Admin | Build the profiles again from the reference recordings |

## Upload
Coordinates are lists, not `{x, y, z}` objects. This makes the body smaller. A frame without a detection is `null`.

```json
{
  "client_id": "uuid made on the device, the same for each retry",
  "sign_id": "uuid of the sign",
  "capture_version": "pwa-0.1.0",
  "meta": {"raw_frame_count": 33, "duration_ms": 2010, "record_duration_ms": 2000, "video_width": 640, "video_height": 480},
  "pose": [[[x, y, z, visibility] × 33] | null] × 30,
  "left_hand": [[[x, y, z] × 21] | null] × 30,
  "right_hand": [[[x, y, z] × 21] | null] × 30,
  "hand_labels": [["Left" | "Right" | null, "Left" | "Right" | null] × 30]
}
```

The server applies the hand rule again (contract/npz.md), validates the data and writes a 1.1 `.npz` file. The response contains the recording and the replay data.

## Errors
The body is always `{"code": "...", ...}`. The interface changes the code into a message.

| HTTP | Codes |
|---|---|
| 401 | `missing_token`, `invalid_token` |
| 403 | `not_registered`, `reviewer_only`, `admin_only`, `cannot_review_own` |
| 404 | `recording_not_found`, `recording_file_missing`, `user_not_found`, `sign_not_found`, `legacy_user_not_found` |
| 409 | `already_registered`, `username_taken`, `busy_retry` (try again), `sign_complete`, `upload_in_progress`, `client_id_conflict`, `slug_taken`, `legacy_already_linked`, `user_has_recordings`, `cannot_remove_own_admin` |
| 422 | `invalid_username`, `blocked_username`, `consent_required`, `unknown_sign`, `invalid_client_id`, `low_quality` (with `validation_flags` and `metrics`), `invalid_*_frames`, `invalid_*_shape`, `invalid_*_values`, `invalid_hand_labels`, `invalid_status`, `too_many_filters`, `invalid_cursor`, `invalid_batch_size`, `invalid_sign`, `invalid_role`, `invalid_trust_level`, `invalid_metadata_schema`, `invalid_sign_metadata` |
| 502 | `storage_error` |

## Tests
```bash
npx --prefix tests/firestore-rules firebase emulators:exec --only auth,firestore --project demo-libras ".venv\Scripts\python.exe -m pytest -q"
```
Without the emulators, only the domain tests run (`.venv\Scripts\python.exe -m pytest -q`).
