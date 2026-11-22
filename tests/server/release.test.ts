// Tests for the dataset releases.
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { getDb } from "../../server/firebase";
import { downloadRelease, INDEX_COLUMNS, latestVersion, parseCsv, publishRelease, toCsv, type IndexRow } from "../../server/release";
import { getStorage } from "../../server/storage";
import { bucketDir, EMULATED, makeBody, person, resetCounter, resetEmulators, sign } from "./helpers";

const row = (overrides: Partial<IndexRow> = {}): IndexRow => ({
  path: "amor/u/01.npz", sign_id: "s", sign_slug: "amor", uuid: "u", video_idx: 1, schema_version: "2.0",
  frame_count: 40, duration_ms: 1950, created_at: "2026-11-22T00:00:00.000Z", pose_rate: 1, left_hand_rate: 0,
  right_hand_rate: 1, active_hand: "right", reference_similarity_score: null, validation_flags: "", ...overrides,
});

describe("csv", () => {
  test("write and read give the same rows, with commas, quotes and new lines", () => {
    const rows = [row({ validation_flags: 'a,b;"c"' }), row({ video_idx: 2, validation_flags: "line\nbreak" })];
    const back = parseCsv(toCsv(rows));
    expect(back).toHaveLength(2);
    expect(back[0].validation_flags).toBe('a,b;"c"');
    expect(back[1].validation_flags).toBe("line\nbreak");
    expect(Object.keys(back[0])).toEqual([...INDEX_COLUMNS]);
    expect(back[0].reference_similarity_score).toBe("");
  });

  test("the index has no field of personal data", () => {
    // The `uuid` column is the random id of the dataset. It is not the Firebase uid.
    for (const forbidden of ["username", "email", "uid", "trust_level", "consent_version"]) {
      expect(INDEX_COLUMNS as readonly string[]).not.toContain(forbidden);
    }
  });
});

describe.skipIf(!EMULATED)("release", () => {
  beforeEach(async () => {
    await resetEmulators();
    resetCounter();
    rmSync(path.join(bucketDir, "releases"), { recursive: true, force: true });
  });

  /** Three recordings of two persons. The reviewer accepts two of them. */
  async function setup() {
    const signId = await sign("amor");
    const [a, b, reviewer] = [await person(), await person(), await person("trusted")];
    const ids = [
      (await a.post("/api/recordings", makeBody(signId))).body.recording.id,
      (await a.post("/api/recordings", makeBody(signId))).body.recording.id,
      (await b.post("/api/recordings", makeBody(signId))).body.recording.id,
    ];
    await reviewer.patch("/api/review/recordings", {
      updates: [{ id: ids[0], status: "accepted" }, { id: ids[2], status: "accepted" }, { id: ids[1], status: "rejected" }],
    });
    return { signId, a, b, ids };
  }

  test("a release has only the accepted recordings, and no personal data", async () => {
    const { signId, a, b } = await setup();
    const result = await publishRelease(getDb(), getStorage());
    expect(result).toMatchObject({ version: 1, rows: 2 });

    const index = parseCsv(readFileSync(path.join(bucketDir, "releases/v1/index.csv"), "utf8"));
    expect(index.map((r) => r.uuid).sort()).toEqual([a.uuid, b.uuid].sort());
    expect(index.every((r) => r.sign_id === signId && r.schema_version === "2.0" && r.frame_count === "40")).toBe(true);

    const everything = ["index.csv", "signs.json", "README.md"]
      .map((f) => readFileSync(path.join(bucketDir, "releases/v1", f), "utf8")).join("\n");
    for (const secret of ["pessoa_1", "pessoa_2", "@example.com", a.uid, b.uid]) expect(everything).not.toContain(secret);

    expect(JSON.parse(readFileSync(path.join(bucketDir, "releases/v1/signs.json"), "utf8")).signs[0].slug).toBe("amor");
    expect(readFileSync(path.join(bucketDir, "releases/v1/README.md"), "utf8")).toContain("Recordings: 2. Persons: 2. Signs: 1.");
    expect(JSON.parse(readFileSync(path.join(bucketDir, "releases/latest.json"), "utf8")).version).toBe("v1");
  });

  test("a dry run writes nothing, and the next release has the next number", async () => {
    await setup();
    expect(await publishRelease(getDb(), getStorage(), { dryRun: true })).toMatchObject({ version: 1, rows: 2 });
    expect(existsSync(path.join(bucketDir, "releases"))).toBe(false);
    await publishRelease(getDb(), getStorage());
    expect((await publishRelease(getDb(), getStorage())).version).toBe(2);
    expect(await latestVersion(getStorage())).toBe(2);
    expect(existsSync(path.join(bucketDir, "releases/v1/index.csv"))).toBe(true);
  });

  test("a missing file stops the release before it writes anything", async () => {
    const { a } = await setup();
    rmSync(path.join(bucketDir, "amor", a.uuid, "01.npz"));
    await expect(publishRelease(getDb(), getStorage())).rejects.toThrow(/1 file\(s\) are missing/);
    expect(existsSync(path.join(bucketDir, "releases"))).toBe(false);
  });

  test("download writes the index and the files of the release", async () => {
    const { a } = await setup();
    await publishRelease(getDb(), getStorage());
    const written = new Map<string, number>();
    const result = await downloadRelease(getStorage(), "latest", "out", async (file, data) => { written.set(file, data.length); });
    expect(result).toEqual({ version: 1, rows: 2 });
    expect([...written.keys()]).toContain("out/index.csv");
    expect([...written.keys()]).toContain(`out/amor/${a.uuid}/01.npz`);
    expect([...written.keys()].filter((f) => f.endsWith(".npz"))).toHaveLength(2);
  });

  test("download tells that there is no release", async () => {
    await expect(downloadRelease(getStorage(), "latest", "out", async () => {})).rejects.toThrow("There is no release.");
  });
});
