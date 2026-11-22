# Contract: dataset releases

The bucket keeps the `.npz` files all the time. It does not keep a live index. To publish the dataset, make a release: a fixed list of accepted recordings, written to the bucket by a script.

Firestore is the source of the review status. Training and the public release use the same script, so they use the same list.

## Bucket layout
```
<sign_slug>/<uuid>/<NN>.npz        recordings (always present)
releases/v<N>/index.csv            accepted recordings in release N
releases/v<N>/signs.json           sign catalog at the time of release N
releases/v<N>/README.md            date, totals and column description
releases/latest.json               {"version": "v<N>", "created_at": "..."}
```

Do not change a release after you publish it. To correct data, make a new release.

## `index.csv`
One row for each recording with status `accepted` at the time of the release.

| Column | Content |
|---|---|
| `path` | Path of the `.npz` file in the bucket |
| `sign_id` | UUID of the sign |
| `sign_slug` | Slug of the sign |
| `uuid` | Random identifier of the person |
| `video_idx` | Recording index |
| `schema_version` | `.npz` format version |
| `frame_count`, `duration_ms` | Frames and duration of the recording |
| `created_at` | Upload time, ISO 8601 UTC |
| `pose_rate`, `left_hand_rate`, `right_hand_rate` | Detection rates |
| `active_hand` | `left`, `right` or `unknown` (extra data only) |
| `reference_similarity_score` | Empty if there was no reference profile |
| `validation_flags` | Codes separated by `;` |

The file has no username, email, Firebase uid or trust level.

## `signs.json`
```json
{
  "schema_version": "1.0",
  "sign_metadata_schema": {"is_dynamic": {"type": "boolean", "label": "Dinâmico"}},
  "signs": [{"id": "uuid", "slug": "amor", "name": "Amor", "video_url": "https://...", "sign_metadata": {}}]
}
```

## Commands
Run them from the project folder. They read `.env` (see `.env.example`): the Firebase service account, the HF token and the bucket name.

```bash
npm run release -- publish --dry-run      # check everything, write nothing
npm run release -- publish                # write releases/v<N>/ and then releases/latest.json
npm run release -- download latest data   # download index.csv, signs.json and the .npz files, for training
```

`publish`:
1. Read the catalog and the `accepted` recordings from Firestore.
2. Make sure that each `.npz` file exists in the bucket. Stop if a file is missing, and write nothing.
3. Write `index.csv`, `signs.json` and `README.md` to a new `releases/v<N>/` folder.
4. Write `releases/latest.json` last, so a reader never sees a release that is not complete.

`download` skips a recording that a person deleted after the release, and says how many.

The code is in `server/release.ts`. The tests are in `tests/server/release.test.ts`.

## Deleted recordings
When a person deletes a recording, the API deletes the `.npz` file and the Firestore document. A release that has this recording keeps the row, but the file is not available. Tell users of old releases about this in the README.
