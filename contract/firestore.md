# Contract: Firestore schema

Firestore keeps persons and metadata. The `.npz` files stay in the bucket (see [npz.md](npz.md)). Public releases come from Firestore (see [release.md](release.md)).

## Principles
- **All writes go through the API**, with the Admin SDK. The browser can only read its own profile (`firestore.rules`).
- **No personal data in the bucket.** The email stays only in Firebase Auth. Do not copy it to Firestore.
- **Dates** are Firestore `timestamp` values, in UTC.
- **Some data is repeated on purpose**, because Firestore has no `JOIN`. Each recording has a copy of `user_trust_level`. When the trust level of a person changes, update all recordings of that person in a batch.
- **Counters** change in the same transaction as the write. Thus, you do not count documents, and you use less quota.

## `users/{uid}`
`uid` is the Firebase Auth uid.

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | Dataset UUID v4. Do not change it |
| `username` | string | As the person typed it |
| `username_key` | string | Normalized form, key of `usernames` |
| `role` | `user` \| `admin` | `admin` manages users and the catalog |
| `trust_level` | `regular` \| `trusted` \| `expert` | Only an admin can change it |
| `show_in_ranking` | bool | Default `false` |
| `consent_version` | string | Version of the accepted consent form |
| `consent_at` | timestamp | |
| `recording_count` | int | Recordings that are not deleted |
| `sign_recordings` | map | `{sign_id: [indexes]}`. The API uses it to find the next index without a read of the recordings. Not indexed |
| `created_at`, `updated_at` | timestamp | |

## `usernames/{username_key}`
Reservation of a unique name. The API creates it in the same transaction as the profile.

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Owner |
| `created_at` | timestamp | |

Name rules: 3 to 20 characters, letters, digits and `_`. `username_key` = lowercase, no accents. Reserved names (such as `admin`) are in the code. Offensive terms are in `config/username_blocklist.terms`. A username that contains one of these terms is blocked.

## `signs/{sign_id}`
`sign_id` is the UUID from the current catalog.

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Folder name in the bucket. It does not change |
| `name` | string | Display name |
| `video_url` | string | Reference video (INES) |
| `metadata` | map | Follows `config/sign_catalog.sign_metadata_schema` (now `is_dynamic`, `is_two_handed`) |
| `active` | bool | An inactive sign is not in the collection, but its recordings stay |
| `order` | int | Order in the collection |
| `recording_count`, `accepted_count`, `reference_count` | int | Counters |
| `created_at`, `updated_at` | timestamp | |

## `recordings/{uuid}_{sign_id}_{NN}`
The id is fixed: a second upload of the same recording does not make a new document.

| Field | Type | Notes |
|---|---|---|
| `uuid`, `sign_id`, `sign_slug` | string | |
| `video_idx` | int | |
| `path` | string | Path in the bucket, for example `letra-a/<uuid>/01.npz` |
| `schema_version`, `capture_version` | string | |
| `frame_count`, `duration_ms` | int | |
| `client_id` | string | UUID that the device makes for each recording. A retry with the same value gives the saved recording |
| `reserved_at` | timestamp | Time of the index reservation |
| `pose_rate`, `left_hand_rate`, `right_hand_rate`, `any_hand_rate`, `both_hands_rate`, `motion_score` | number | |
| `active_hand` | `left` \| `right` \| `unknown` | Extra data (see npz.md) |
| `validation_flags` | array of string | Codes, never messages |
| `reference_similarity_score` | number \| null | |
| `status` | see below | |
| `user_trust_level` | string | Copy of the trust level of the author |
| `counts_as_reference` | bool | `status == accepted` and `user_trust_level == expert` |
| `reviewed_by` | string \| null | uid of the reviewer |
| `reviewed_at`, `created_at`, `updated_at` | timestamp | |

Status:
- `uploading`: internal, between the index reservation and the file confirmation. It never shows in review or to the person.
- `unreviewed`: default for `regular`.
- `trusted_unreviewed`: default for `trusted` and `expert`.
- `accepted` and `rejected`: after review.

When the person deletes a recording, the API deletes the `.npz` file and the document.

Review: `trusted`, `expert` and `admin` can review, but never their own recordings.

## `config/*`
- `config/sign_catalog`: `schema_version`, `sign_metadata_schema`. The release script writes `signs.json` to the bucket from this document and from `signs`.
- `config/reference_profiles`: profiles by `sign_id` (UUID), `min_references`, `schema_version`, `build`.
- `config/username_blocklist`: `terms` (array).

## Upload flow
1. Reservation transaction: find the `client_id`. If it exists and is complete, return that recording (retry). If not, select the first free index up to the limit per sign. Make sure that the document of that index does not exist. Then create the recording with status `uploading`.
2. Write the `.npz` file to the bucket. If this fails, cancel the reservation.
3. Confirmation transaction: set the initial status for the trust level and increase the counters.

If the function stops between steps 1 and 3, the recording stays `uploading`. A retry with the same `client_id` after 2 minutes continues the reservation. Without a retry, the index stays blocked until a cleanup script (not written yet) releases it.

## Queries and indexes
The indexes are in `firestore.indexes.json`. A query that is not in this list needs a new index.

| Use | Filters | Order |
|---|---|---|
| Review | `status` | `created_at` desc |
| Review by sign | `status`, `sign_id` | `created_at` desc |
| Review by trust level | `status`, `user_trust_level` | `created_at` desc |
| Review by flag | `status`, `validation_flags` contains | `created_at` desc |
| Review by person | `status`, `uuid` | `created_at` desc |
| Own recordings | `uuid` | `created_at` desc |
| Retry | `client_id ==` | — |
| Release | `status == accepted` | — |
| Reference profiles | `counts_as_reference == true` | — |
| Ranking | `show_in_ranking == true` | `recording_count` desc |

Review always filters by one status. There is no text search. To find a person, use the exact username. The API changes it to a `uuid`. Pagination uses a cursor (`startAfter`), 50 items per page.

## Estimated cost per operation
Document reads and writes. Compare with the free quota: 50,000 reads and 20,000 writes per day.

| Operation | Reads | Writes |
|---|---|---|
| Registration | 2 | 2 |
| Upload | approximately 7 (profile, sign, reservation, confirmation, response) | 5 (reservation: recording and user; confirmation: recording, user and sign) |
| Review page | 50 | 0 |
| Batch review of 50 | 50 | 100 (recordings and sign counters) |
| Release | 1 for each accepted recording | 0 |
