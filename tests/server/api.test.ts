// API tests on the Auth and Firestore emulators, with the bucket in a local folder.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { RIGHT, LEFT } from "../../shared/capture";
import { app } from "../../server/app";
import { getDb } from "../../server/firebase";
import { readNpz } from "../../server/npz";
import { setStorage, type Storage } from "../../server/storage";
import {
  bucketDir, doc, EMULATED, makeBody, person, resetCounter, resetEmulators, sign, signUp,
} from "./helpers";

const sum = (mask: Uint8Array) => mask.reduce((a, b) => a + b, 0);

describe.skipIf(!EMULATED)("api", () => {
  beforeEach(async () => {
    await resetEmulators();
    resetCounter();
  });

  // ---------- registration ----------

  test("no token and no profile", async () => {
    expect((await (await app.request("/api/me")).json()).code).toBe("missing_token");
    const bad = await app.request("/api/me", { headers: { Authorization: "Bearer x" } });
    expect((await bad.json()).code).toBe("invalid_token");
    const p = await signUp();
    const response = await p.get("/api/me");
    expect([response.status, response.body.code]).toEqual([403, "not_registered"]);
  });

  test("registration", async () => {
    const p = await signUp();
    expect((await p.get("/api/usernames/Jose_1/available")).body).toEqual({ username_key: "jose_1", available: true });
    const created = await p.post("/api/me", { username: "José_1", consent_version: "v1" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ trust_level: "regular", role: "user", show_in_ranking: false });
    expect((await doc("usernames", "jose_1")).uid).toBe(p.uid);
    expect(await doc("users", p.uid)).not.toHaveProperty("email");
    expect((await p.post("/api/me", { username: "outro", consent_version: "v1" })).body.code).toBe("already_registered");

    const other = await signUp();
    for (const name of ["jose_1", "JOSÉ_1"]) {
      const taken = await other.post("/api/me", { username: name, consent_version: "v1" });
      expect([taken.status, taken.body.code]).toEqual([409, "username_taken"]);
    }
    expect((await other.post("/api/me", { username: "admin", consent_version: "v1" })).body.code).toBe("blocked_username");
    expect((await other.post("/api/me", { username: "semtermo" })).body.code).toBe("consent_required");
  });

  test("concurrent username: only one wins", async () => {
    const people = await Promise.all(Array.from({ length: 6 }, () => signUp()));
    const results = await Promise.all(
      people.map((p) => p.post("/api/me", { username: "disputado", consent_version: "v1" })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect((await getDb().collection("users").get()).size).toBe(1);
  });

  test("a person cannot change their own trust level", async () => {
    const p = await person();
    await p.patch("/api/me", { show_in_ranking: true, trust_level: "expert", role: "admin" });
    expect(await doc("users", p.uid)).toMatchObject({ show_in_ranking: true, trust_level: "regular", role: "user" });
  });

  // ---------- upload ----------

  test("upload", async () => {
    const p = await person();
    const signId = await sign("amor");
    const response = await p.post("/api/recordings", makeBody(signId, { swapChannels: true }));
    expect(response.status).toBe(201);
    expect(response.body.recording).toMatchObject({
      status: "unreviewed", video_idx: 1, active_hand: "right", right_hand_rate: 1, left_hand_rate: 0,
      schema_version: "2.0", frame_count: 40, duration_ms: 1950,
    });
    expect(response.body.replay.frame_count).toBe(40);

    const { capture, meta } = readNpz(new Uint8Array(readFileSync(path.join(bucketDir, "amor", p.uuid, "01.npz"))));
    expect(meta).toMatchObject({ schema_version: "2.0", sign_id: signId, video_width: 640 });
    expect(sum(capture.hands[RIGHT].mask)).toBe(40);
    expect(sum(capture.hands[LEFT].mask)).toBe(0);

    expect(await doc("users", p.uid)).toMatchObject({ recording_count: 1, sign_recordings: { [signId]: [1] } });
    expect((await doc("signs", signId)).recording_count).toBe(1);
  });

  test("the trust level sets the initial status", async () => {
    const signId = await sign();
    const response = await (await person("trusted")).post("/api/recordings", makeBody(signId));
    expect(response.body.recording.status).toBe("trusted_unreviewed");
  });

  test("a retry does not duplicate", async () => {
    const p = await person();
    const signId = await sign();
    const body = makeBody(signId);
    const first = await p.post("/api/recordings", body);
    const again = await p.post("/api/recordings", body);
    expect([first.status, again.status, again.body.duplicate]).toEqual([201, 200, true]);
    expect(again.body.recording.id).toBe(first.body.recording.id);
    expect((await doc("users", p.uid)).recording_count).toBe(1);
    expect((await doc("signs", signId)).recording_count).toBe(1);
  });

  test("client_id of another person", async () => {
    const signId = await sign();
    const body = makeBody(signId);
    await (await person()).post("/api/recordings", body);
    const response = await (await person()).post("/api/recordings", body);
    expect([response.status, response.body.code]).toEqual([409, "client_id_conflict"]);
  });

  test("a bad recording is not saved", async () => {
    const p = await person();
    const signId = await sign("ruim");
    const response = await p.post("/api/recordings", makeBody(signId, { poseMissing: 20, handMissing: 35 }));
    expect([response.status, response.body.code]).toEqual([422, "low_quality"]);
    expect(response.body.validation_flags).toEqual(["low_pose_rate", "low_any_hand_rate"]);
    expect(existsSync(path.join(bucketDir, "ruim"))).toBe(false);
    expect((await doc("users", p.uid)).recording_count).toBe(0);
    expect((await getDb().collection("recordings").get()).size).toBe(0);

    const broken = await p.post("/api/recordings", { ...makeBody(signId), pose: "###" });
    expect([broken.status, broken.body.code]).toEqual([422, "invalid_pose"]);
  });

  test("unknown or inactive sign", async () => {
    const p = await person();
    for (const signId of ["nao-existe", await sign("parado", false)]) {
      const response = await p.post("/api/recordings", makeBody(signId));
      expect([response.status, response.body.code]).toEqual([422, "unknown_sign"]);
    }
  });

  test("limit per sign and index reuse", async () => {
    const p = await person();
    const signId = await sign("limite");
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) ids.push((await p.post("/api/recordings", makeBody(signId))).body.recording.id);
    const full = await p.post("/api/recordings", makeBody(signId));
    expect([full.status, full.body.code]).toEqual([409, "sign_complete"]);

    expect((await p.delete(`/api/me/recordings/${ids[1]}`)).status).toBe(204);
    expect(existsSync(path.join(bucketDir, "limite", p.uuid, "02.npz"))).toBe(false);
    expect(await doc("recordings", ids[1])).toBeUndefined();
    expect((await doc("users", p.uid)).recording_count).toBe(3);

    const again = await p.post("/api/recordings", makeBody(signId));
    expect([again.status, again.body.recording.video_idx]).toEqual([201, 2]);
    expect((await doc("signs", signId)).recording_count).toBe(4);
    expect((await p.get("/api/me/recordings")).body.items).toHaveLength(4);
  });

  test("an index that is missing from the user map is not overwritten", async () => {
    const p = await person();
    const signId = await sign();
    await getDb().collection("recordings").doc(`${p.uuid}_${signId}_01`).set({ status: "accepted", uuid: p.uuid });
    const response = await p.post("/api/recordings", makeBody(signId));
    expect(response.body.recording.video_idx).toBe(2);
    expect((await doc("recordings", `${p.uuid}_${signId}_01`)).status).toBe("accepted");
  });

  test("a bucket failure releases the index", async () => {
    const p = await person();
    const signId = await sign();
    const failing: Storage = {
      put: async () => { throw new Error("unavailable"); },
      get: async () => null,
      delete: async () => {},
    };
    setStorage(failing);
    const response = await p.post("/api/recordings", makeBody(signId));
    expect([response.status, response.body.code]).toEqual([502, "storage_error"]);
    expect((await doc("users", p.uid)).sign_recordings).toEqual({ [signId]: [] });
    expect((await getDb().collection("recordings").get()).size).toBe(0);
  });

  test("a person can delete only their own recording", async () => {
    const signId = await sign();
    const owner = await person();
    const other = await person();
    const id = (await owner.post("/api/recordings", makeBody(signId))).body.recording.id;
    expect((await other.delete(`/api/me/recordings/${id}`)).status).toBe(404);
    expect((await owner.delete(`/api/me/recordings/${id}`)).status).toBe(204);
    expect((await owner.delete(`/api/me/recordings/${id}`)).status).toBe(404);
  });

  test("replay", async () => {
    const signId = await sign();
    const owner = await person();
    const other = await person();
    const reviewer = await person("trusted");
    const id = (await owner.post("/api/recordings", makeBody(signId))).body.recording.id;
    const mine = await owner.get(`/api/recordings/${id}/replay`);
    expect([mine.status, mine.body.frame_count, mine.body.pose[0][0].length]).toEqual([200, 40, 3]);
    expect((await other.get(`/api/recordings/${id}/replay`)).status).toBe(404);
    expect((await reviewer.get(`/api/recordings/${id}/replay`)).status).toBe(200);
  });

  test("next signs for a session", async () => {
    const a = await sign("a");
    const b = await sign("b");
    const c = await sign("c");
    const p = await person();
    const other = await person();
    await other.post("/api/recordings", makeBody(a));
    await other.post("/api/recordings", makeBody(a));
    await other.post("/api/recordings", makeBody(b));
    for (let i = 0; i < 4; i += 1) await p.post("/api/recordings", makeBody(c));
    // Refresh the profile: the caller reads `sign_recordings` at request time.
    const next = await p.get("/api/collect/next?count=5");
    expect(next.body.signs.map((s: any) => s.slug)).toEqual(["b", "a"]);
    expect(next.body).toMatchObject({ remaining_signs: 2, target_per_sign: 4 });
  });

  // ---------- review ----------

  test("review permissions", async () => {
    const signId = await sign();
    const regular = await person();
    const trusted = await person("trusted");
    const expert = await person("expert");
    const own = (await trusted.post("/api/recordings", makeBody(signId))).body.recording.id;
    const rec = (await regular.post("/api/recordings", makeBody(signId))).body.recording.id;

    expect((await regular.get("/api/review/recordings?status=unreviewed")).body.code).toBe("reviewer_only");
    const self = await trusted.patch("/api/review/recordings", { updates: [{ id: own, status: "accepted" }] });
    expect([self.status, self.body.code]).toEqual([403, "cannot_review_own"]);

    const reviewed = await expert.patch("/api/review/recordings", {
      updates: [{ id: own, status: "accepted" }, { id: rec, status: "rejected" }],
    });
    expect(reviewed.status).toBe(200);
    expect((await doc("recordings", own)).reviewed_by).toBe(expert.uid);
    // The author is trusted, so an accepted recording is not a reference.
    expect(await doc("signs", signId)).toMatchObject({ accepted_count: 1, reference_count: 0 });

    await trusted.patch("/api/review/recordings", { updates: [{ id: rec, status: "pending" }] });
    expect(await doc("recordings", rec)).toMatchObject({ status: "unreviewed", reviewed_by: null });
  });

  test("reference and counters", async () => {
    const signId = await sign();
    const expert = await person("expert");
    const reviewer = await person("trusted");
    const rec = (await expert.post("/api/recordings", makeBody(signId))).body.recording.id;
    await reviewer.patch("/api/review/recordings", { updates: [{ id: rec, status: "accepted" }] });
    expect((await doc("recordings", rec)).counts_as_reference).toBe(true);
    expect((await doc("signs", signId)).reference_count).toBe(1);
    await expert.delete(`/api/me/recordings/${rec}`);
    expect(await doc("signs", signId)).toMatchObject({ recording_count: 0, accepted_count: 0, reference_count: 0 });
  });

  test("review list", async () => {
    const a = await sign("a");
    const b = await sign("b");
    const p1 = await person();
    const p2 = await person();
    const reviewer = await person("trusted");
    await p1.post("/api/recordings", makeBody(a));
    await p1.post("/api/recordings", makeBody(a));
    await p2.post("/api/recordings", makeBody(b));
    await getDb().collection("recordings").doc(`${p2.uuid}_${b}_01`).update({ validation_flags: ["low_motion_reference"] });

    expect((await reviewer.get("/api/review/recordings")).body.code).toBe("invalid_status");
    expect((await reviewer.get(`/api/review/recordings?status=unreviewed&sign_id=${a}&flag=x`)).body.code)
      .toBe("too_many_filters");

    const ids = async (query: string) =>
      (await reviewer.get(`/api/review/recordings?status=unreviewed${query}`)).body.items.map((i: any) => i.id);
    expect(await ids("")).toHaveLength(3);
    expect(await ids(`&sign_id=${a}`)).toHaveLength(2);
    expect(await ids("&flag=low_motion_reference")).toEqual([`${p2.uuid}_${b}_01`]);
    expect(await ids("&username=pessoa_1")).toHaveLength(2);
    expect(await ids("&username=ninguem")).toEqual([]);
    expect(await ids("&trust_level=regular")).toHaveLength(3);

    const page = (await reviewer.get("/api/review/recordings?status=unreviewed&limit=2")).body;
    expect(page.items).toHaveLength(2);
    const rest = (await reviewer.get(`/api/review/recordings?status=unreviewed&limit=2&cursor=${page.next_cursor}`)).body;
    expect([rest.items.length, rest.next_cursor]).toEqual([1, null]);
  });

  // ---------- administration ----------

  test("an admin changes a trust level, and the recordings follow", async () => {
    const signId = await sign();
    const admin = await person("regular", "admin");
    const p = await person();
    const reviewer = await person("trusted");
    expect((await p.get("/api/admin/users")).body.code).toBe("admin_only");
    const recs: string[] = [];
    for (let i = 0; i < 2; i += 1) recs.push((await p.post("/api/recordings", makeBody(signId))).body.recording.id);
    await reviewer.patch("/api/review/recordings", { updates: [{ id: recs[0], status: "accepted" }] });

    const changed = await admin.patch(`/api/admin/users/${p.uid}`, { trust_level: "expert" });
    expect([changed.status, changed.body.trust_level]).toEqual([200, "expert"]);
    expect(await doc("recordings", recs[0])).toMatchObject({ counts_as_reference: true, user_trust_level: "expert" });
    expect((await doc("recordings", recs[1])).status).toBe("trusted_unreviewed");
    expect((await doc("signs", signId)).reference_count).toBe(1);

    await admin.patch(`/api/admin/users/${p.uid}`, { trust_level: "regular" });
    expect((await doc("signs", signId)).reference_count).toBe(0);
    expect((await doc("recordings", recs[1])).status).toBe("unreviewed");

    expect((await admin.patch(`/api/admin/users/${admin.uid}`, { role: "user" })).body.code)
      .toBe("cannot_remove_own_admin");
    expect((await admin.get("/api/admin/users?username=pessoa_2")).body.items[0].uid).toBe(p.uid);
  });

  test("catalog", async () => {
    const admin = await person("regular", "admin");
    await getDb().collection("config").doc("sign_catalog").set({
      schema_version: "1.0", sign_metadata_schema: { is_dynamic: { type: "boolean", label: "Dinâmico" } },
    });
    const created = await admin.post("/api/admin/signs", {
      name: "À vista", video_url: "https://example.com/v.mp4", sign_metadata: { is_dynamic: true },
    });
    expect([created.status, created.body.slug]).toEqual([201, "a-vista"]);
    const duplicate = await admin.post("/api/admin/signs", { name: "A vista", video_url: "https://example.com/x.mp4" });
    expect([duplicate.status, duplicate.body.code]).toEqual([409, "slug_taken"]);

    const renamed = await admin.patch(`/api/admin/signs/${created.body.id}`, { name: "À vista (pagamento)" });
    expect(renamed.body.slug).toBe("a-vista");

    const open = await app.request("/api/signs");
    expect(open.headers.get("cache-control")).toContain("s-maxage");
    expect((await open.json()).signs.map((s: any) => s.slug)).toEqual(["a-vista"]);
    await admin.patch(`/api/admin/signs/${created.body.id}`, { active: false });
    expect((await (await app.request("/api/signs")).json()).signs).toEqual([]);

    const schema = await admin.put("/api/admin/sign-metadata-schema", {
      sign_metadata_schema: { is_two_handed: { type: "boolean", label: "Duas mãos" } },
    });
    expect(schema.body.schema_version).toBe("2.0");
    expect(schema.body.signs[0].sign_metadata).toEqual({ is_two_handed: false });
  });

  test("reference profiles", async () => {
    const signId = await sign();
    const admin = await person("regular", "admin");
    const expert = await person("expert");
    const recs: string[] = [];
    for (let i = 0; i < 3; i += 1) recs.push((await expert.post("/api/recordings", makeBody(signId))).body.recording.id);
    await admin.patch("/api/review/recordings", { updates: recs.map((id) => ({ id, status: "accepted" })) });

    const built = (await admin.post("/api/admin/reference-profiles/rebuild", { min_references: 3 })).body;
    expect(built.profiles[signId]).toMatchObject({ reference_count: 3, min_any_hand_rate: 1 });
    expect(built.build.errors).toEqual([]);

    // With an active profile, a static recording gets a warning, but the API saves it.
    const still = await (await person()).post("/api/recordings", makeBody(signId, { still: true }));
    expect(still.status).toBe(201);
    expect(still.body.recording.validation_flags).toContain("low_motion_reference");
  });

  test("stats", async () => {
    const signId = await sign();
    const shown = await person("regular", "user", true);
    const hidden = await person();
    await shown.post("/api/recordings", makeBody(signId));
    await hidden.post("/api/recordings", makeBody(signId));
    const body = await (await app.request("/api/stats")).json();
    expect(body.total_recordings).toBe(2);
    expect(body.ranking).toEqual([{ username: "pessoa_1", recording_count: 1 }]);
  });
});
