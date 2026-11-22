// Dataset releases. See contract/release.md.
// A release is a fixed list of the accepted recordings, written to the bucket by a script.
import type { Firestore } from "firebase-admin/firestore";
import { catalog } from "./services.js";
import type { Storage } from "./storage.js";

export const INDEX_COLUMNS = [
  "path", "sign_id", "sign_slug", "uuid", "video_idx", "schema_version", "frame_count", "duration_ms",
  "created_at", "pose_rate", "left_hand_rate", "right_hand_rate", "active_hand",
  "reference_similarity_score", "validation_flags",
] as const;

export type IndexRow = Record<(typeof INDEX_COLUMNS)[number], string | number | null>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: IndexRow[]): string {
  const lines = [INDEX_COLUMNS.join(",")];
  for (const row of rows) lines.push(INDEX_COLUMNS.map((column) => cell(row[column])).join(","));
  return lines.join("\n") + "\n";
}

/** Read the CSV that `toCsv` writes. It handles quoted cells with commas, quotes and new lines. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { current += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(current); current = ""; }
    else if (char === "\n") { row.push(current); rows.push(row); row = []; current = ""; }
    else if (char !== "\r") current += char;
  }
  if (current !== "" || row.length > 0) { row.push(current); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((values) => Object.fromEntries(header.map((name, i) => [name, values[i] ?? ""])));
}

export function folder(version: number): string {
  return `releases/v${version}`;
}

/** The version of the latest release, or 0 when there is none. */
export async function latestVersion(storage: Storage): Promise<number> {
  const file = await storage.get("releases/latest.json");
  if (!file) return 0;
  return Number(JSON.parse(decoder.decode(file)).version?.replace(/^v/, "")) || 0;
}

function readme(version: number, createdAt: string, rows: IndexRow[], signNames: Map<string, string>): string {
  const people = new Set(rows.map((r) => r.uuid)).size;
  const perSign = new Map<string, number>();
  for (const row of rows) perSign.set(String(row.sign_id), (perSign.get(String(row.sign_id)) ?? 0) + 1);
  const lines = [
    `# Lia Libras dataset, release v${version}`,
    "",
    `Created: ${createdAt}`,
    `Recordings: ${rows.length}. Persons: ${people}. Signs: ${perSign.size}.`,
    "",
    "Each recording is a `.npz` file with the landmarks of the pose and of the two hands. There is no video.",
    "The format is in `contract/npz.md` of the project repository. `index.csv` lists the files in this release.",
    "",
    "A person can delete a recording after a release. The row stays in `index.csv`, but the file can be absent.",
    "",
    "## Recordings for each sign",
    "",
    ...[...perSign].sort().map(([id, count]) => `- ${signNames.get(id) ?? id}: ${count}`),
    "",
  ];
  return lines.join("\n");
}

export interface PublishResult {
  version: number;
  rows: number;
  files: string[];
}

/**
 * Publish the accepted recordings as a new release. It stops before it writes anything if a file is missing.
 * With `dryRun`, it checks everything and writes nothing.
 */
export async function publishRelease(
  db: Firestore, storage: Storage, options: { dryRun?: boolean; now?: Date } = {},
): Promise<PublishResult> {
  const createdAt = (options.now ?? new Date()).toISOString();
  const [{ signs, sign_metadata_schema, schema_version }, snaps] = await Promise.all([
    catalog(db, true),
    db.collection("recordings").where("status", "==", "accepted").orderBy("created_at").get(),
  ]);

  const rows: IndexRow[] = snaps.docs.map((snap) => {
    const d = snap.data();
    return {
      path: d.path,
      sign_id: d.sign_id,
      sign_slug: d.sign_slug,
      uuid: d.uuid,
      video_idx: d.video_idx,
      schema_version: d.schema_version,
      frame_count: d.frame_count,
      duration_ms: d.duration_ms,
      created_at: d.created_at?.toDate?.().toISOString() ?? "",
      pose_rate: d.pose_rate,
      left_hand_rate: d.left_hand_rate,
      right_hand_rate: d.right_hand_rate,
      active_hand: d.active_hand,
      reference_similarity_score: d.reference_similarity_score ?? null,
      validation_flags: (d.validation_flags ?? []).join(";"),
    };
  });

  const missing: string[] = [];
  for (const row of rows) if (!(await storage.exists(String(row.path)))) missing.push(String(row.path));
  if (missing.length > 0) throw new Error(`${missing.length} file(s) are missing in the bucket: ${missing.slice(0, 5).join(", ")}`);

  const version = (await latestVersion(storage)) + 1;
  const used = new Set(rows.map((r) => String(r.sign_id)));
  const signsJson = {
    schema_version,
    sign_metadata_schema,
    signs: signs.filter((s) => s.active || used.has(s.id)).map((s) => ({
      id: s.id, slug: s.slug, name: s.name, video_url: s.video_url, sign_metadata: s.sign_metadata,
    })),
  };
  const dir = folder(version);
  const files = {
    [`${dir}/index.csv`]: toCsv(rows),
    [`${dir}/signs.json`]: JSON.stringify(signsJson, null, 2) + "\n",
    [`${dir}/README.md`]: readme(version, createdAt, rows, new Map(signs.map((s) => [s.id, s.name]))),
  };
  if (!options.dryRun) {
    for (const [path, content] of Object.entries(files)) await storage.put(path, encoder.encode(content));
    // The pointer is the last file, so a reader never sees a release that is not complete.
    await storage.put("releases/latest.json", encoder.encode(JSON.stringify({ version: `v${version}`, created_at: createdAt }) + "\n"));
  }
  return { version, rows: rows.length, files: Object.keys(files) };
}

/** Download a release to a local folder, for training. Return the number of recordings. */
export async function downloadRelease(
  storage: Storage, version: number | "latest", dir: string,
  write: (path: string, data: Uint8Array) => Promise<void>,
): Promise<{ version: number; rows: number }> {
  const number = version === "latest" ? await latestVersion(storage) : version;
  if (!number) throw new Error("There is no release.");
  const base = folder(number);
  const need = async (path: string) => {
    const data = await storage.get(path);
    if (!data) throw new Error(`File not found in the bucket: ${path}`);
    return data;
  };
  for (const name of ["index.csv", "signs.json", "README.md"]) await write(`${dir}/${name}`, await need(`${base}/${name}`));
  const rows = parseCsv(decoder.decode(await need(`${base}/index.csv`)));
  let skipped = 0;
  for (const row of rows) {
    const data = await storage.get(row.path);
    // A person can delete a recording after the release. Skip it and tell the person who trains.
    if (!data) { skipped += 1; continue; }
    await write(`${dir}/${row.path}`, data);
  }
  if (skipped > 0) console.warn(`${skipped} recording(s) of this release were deleted and are not downloaded.`);
  return { version: number, rows: rows.length - skipped };
}
