// Operations on Firestore and on the bucket. See the schema in contract/firestore.md.
import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { CaptureError, decodeCapture, SCHEMA_VERSION, type UploadBody } from "../shared/capture.js";
import { activeHand, assignHands } from "../shared/hands.js";
import {
  assessReference, basicFlags, buildProfile, recordingMetrics, type Metrics, type ReferenceProfiles,
} from "../shared/metrics.js";
import {
  NamingError, normalizeMetadata, slugify, usernameKey, validateMetadataSchema, type MetadataSchema,
} from "../shared/naming.js";
import { ApiError } from "./errors.js";
import { readNpz, replayPayload, writeNpz } from "./npz.js";
import type { Settings } from "./settings.js";
import type { Storage } from "./storage.js";

const USERS = "users";
const USERNAMES = "usernames";
const SIGNS = "signs";
const RECORDINGS = "recordings";
const CONFIG = "config";

const TRUST_LEVELS = ["regular", "trusted", "expert"];
const REVIEWER_LEVELS = new Set(["trusted", "expert"]);
const PENDING = new Set(["unreviewed", "trusted_unreviewed"]);
const LISTABLE_STATUSES = ["unreviewed", "trusted_unreviewed", "accepted", "rejected"];
const STALE_UPLOAD_MS = 2 * 60 * 1000;
const MAX_REVIEW_BATCH = 50;
const PROFILES_CACHE_MS = 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Doc = DocumentData;

let profilesCache: { at: number; value: ReferenceProfiles } | undefined;

export function clearCaches(): void {
  profilesCache = undefined;
}

function iso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function named<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof NamingError) throw new ApiError(422, error.code);
    throw error;
  }
}

/** Run a transaction. If contention stops all attempts, send a retry code. */
async function transaction<T>(db: Firestore, fn: (t: Transaction) => Promise<T>): Promise<T> {
  try {
    return await db.runTransaction(fn, { maxAttempts: 10 });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const code = (error as { code?: number }).code;
    if (code === 10 || code === 6) throw new ApiError(409, "busy_retry");
    throw error;
  }
}

export function defaultStatus(trustLevel: string): string {
  return REVIEWER_LEVELS.has(trustLevel) ? "trusted_unreviewed" : "unreviewed";
}

function countsAsReference(status: string, trustLevel: string): boolean {
  return status === "accepted" && trustLevel === "expert";
}

export function isAdmin(user: Doc): boolean {
  return user.role === "admin";
}

export function isReviewer(user: Doc): boolean {
  return isAdmin(user) || REVIEWER_LEVELS.has(user.trust_level);
}

// ---------- profile ----------

export function publicProfile(uid: string, data: Doc) {
  return {
    uid,
    uuid: data.uuid,
    username: data.username,
    role: data.role ?? "user",
    trust_level: data.trust_level ?? "regular",
    show_in_ranking: Boolean(data.show_in_ranking),
    consent_version: data.consent_version,
    recording_count: data.recording_count ?? 0,
    sign_recordings: data.sign_recordings ?? {},
    created_at: iso(data.created_at),
  };
}

async function blockedTerms(db: Firestore): Promise<string[]> {
  const snap = await db.collection(CONFIG).doc("username_blocklist").get();
  return ((snap.data()?.terms as string[]) ?? []).map((term) => String(term).toLowerCase());
}

export async function usernameAvailable(db: Firestore, username: string) {
  const terms = await blockedTerms(db);
  const key = named(() => usernameKey(username, terms));
  const taken = (await db.collection(USERNAMES).doc(key).get()).exists;
  return { username_key: key, available: !taken };
}

export async function register(
  db: Firestore, uid: string, username: string, showInRanking: boolean, consentVersion: string,
) {
  if (!consentVersion) throw new ApiError(422, "consent_required");
  const terms = await blockedTerms(db);
  const key = named(() => usernameKey(username, terms));
  const userRef = db.collection(USERS).doc(uid);
  const nameRef = db.collection(USERNAMES).doc(key);
  try {
    await transaction(db, async (t) => {
      const [user, name] = await t.getAll(userRef, nameRef);
      if (user.exists) throw new ApiError(409, "already_registered");
      if (name.exists) throw new ApiError(409, "username_taken");
      t.create(nameRef, { uid, created_at: FieldValue.serverTimestamp() });
      t.create(userRef, {
        uuid: randomUUID(),
        username: username.trim(),
        username_key: key,
        role: "user",
        trust_level: "regular",
        show_in_ranking: showInRanking,
        consent_version: consentVersion,
        consent_at: FieldValue.serverTimestamp(),
        recording_count: 0,
        sign_recordings: {},
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "busy_retry") throw error;
    // Another transaction created the same username or profile at the same time.
    if ((await userRef.get()).exists) throw new ApiError(409, "already_registered");
    if ((await nameRef.get()).exists) throw new ApiError(409, "username_taken");
    throw error;
  }
  return publicProfile(uid, (await userRef.get()).data()!);
}

export async function updateMe(db: Firestore, uid: string, showInRanking: boolean) {
  const ref = db.collection(USERS).doc(uid);
  await ref.update({ show_in_ranking: showInRanking, updated_at: FieldValue.serverTimestamp() });
  return publicProfile(uid, (await ref.get()).data()!);
}

// ---------- catalog and statistics ----------

async function catalogConfig(db: Firestore): Promise<{ schema_version: string; sign_metadata_schema: MetadataSchema }> {
  const data = (await db.collection(CONFIG).doc("sign_catalog").get()).data() ?? {};
  return {
    schema_version: data.schema_version ?? "1.0",
    sign_metadata_schema: data.sign_metadata_schema ?? {},
  };
}

export function publicSign(id: string, data: Doc) {
  return {
    id,
    slug: data.slug,
    name: data.name,
    video_url: data.video_url,
    sign_metadata: data.metadata ?? {},
    active: data.active ?? true,
    order: data.order ?? 0,
    recording_count: data.recording_count ?? 0,
    accepted_count: data.accepted_count ?? 0,
    reference_count: data.reference_count ?? 0,
  };
}

export async function catalog(db: Firestore, includeInactive = false) {
  const snaps = await db.collection(SIGNS).get();
  let signs = snaps.docs.map((s) => publicSign(s.id, s.data()));
  if (!includeInactive) signs = signs.filter((s) => s.active);
  signs.sort((a, b) => a.order - b.order || String(a.name).localeCompare(String(b.name), "pt-BR"));
  return { ...(await catalogConfig(db)), signs };
}

/** Signs for the next collection session: the person did not complete them, and they have the fewest recordings. */
export async function nextSigns(db: Firestore, settings: Settings, user: Doc, count: number) {
  const { signs } = await catalog(db);
  const mine = (user.sign_recordings ?? {}) as Record<string, number[]>;
  const open = signs
    .filter((s) => (mine[s.id]?.length ?? 0) < settings.targetPerSign)
    .sort((a, b) => a.recording_count - b.recording_count || a.order - b.order);
  return {
    target_per_sign: settings.targetPerSign,
    remaining_signs: open.length,
    signs: open.slice(0, Math.max(1, Math.min(count, 20))),
  };
}

export async function stats(db: Firestore, rankingSize = 20) {
  const signs = (await db.collection(SIGNS).get()).docs.map((s) => s.data());
  const top = await db.collection(USERS)
    .where("show_in_ranking", "==", true)
    .orderBy("recording_count", "desc")
    .limit(rankingSize)
    .get();
  return {
    total_recordings: signs.reduce((sum, s) => sum + (s.recording_count ?? 0), 0),
    accepted_recordings: signs.reduce((sum, s) => sum + (s.accepted_count ?? 0), 0),
    ranking: top.docs
      .map((s) => ({ username: s.get("username"), recording_count: s.get("recording_count") ?? 0 }))
      .filter((row) => row.recording_count > 0),
  };
}

// ---------- recordings ----------

export function publicRecording(id: string, data: Doc) {
  return {
    id,
    uuid: data.uuid,
    sign_id: data.sign_id,
    sign_slug: data.sign_slug,
    video_idx: data.video_idx,
    status: data.status,
    schema_version: data.schema_version,
    frame_count: data.frame_count,
    duration_ms: data.duration_ms,
    pose_rate: data.pose_rate,
    left_hand_rate: data.left_hand_rate,
    right_hand_rate: data.right_hand_rate,
    any_hand_rate: data.any_hand_rate,
    both_hands_rate: data.both_hands_rate,
    motion_score: data.motion_score,
    active_hand: data.active_hand,
    validation_flags: data.validation_flags ?? [],
    reference_similarity_score: data.reference_similarity_score ?? null,
    user_trust_level: data.user_trust_level,
    counts_as_reference: Boolean(data.counts_as_reference),
    reviewed_at: iso(data.reviewed_at),
    created_at: iso(data.created_at),
  };
}

export async function loadProfiles(db: Firestore): Promise<ReferenceProfiles> {
  if (profilesCache && Date.now() - profilesCache.at < PROFILES_CACHE_MS) return profilesCache.value;
  const data = (await db.collection(CONFIG).doc("reference_profiles").get()).data();
  const value = (data as ReferenceProfiles | undefined) ?? { profiles: {} };
  profilesCache = { at: Date.now(), value };
  return value;
}

function clampInt(value: unknown, low: number, high: number): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(Math.max(number, low), high) : low;
}

export async function upload(
  db: Firestore, storage: Storage, settings: Settings, uid: string, user: Doc, body: Partial<UploadBody>,
) {
  const clientId = String(body.client_id ?? "");
  if (!UUID.test(clientId)) throw new ApiError(422, "invalid_client_id");
  const signId = String(body.sign_id ?? "");
  const signRef = db.collection(SIGNS).doc(signId || "-");
  const sign = (await signRef.get()).data();
  if (!sign || sign.active === false) throw new ApiError(422, "unknown_sign");

  let capture;
  try {
    capture = assignHands(decodeCapture(body));
  } catch (error) {
    if (error instanceof CaptureError) throw new ApiError(422, error.code);
    throw error;
  }
  const metrics = recordingMetrics(capture);
  const failures = basicFlags(metrics);
  if (failures.length > 0) throw new ApiError(422, "low_quality", { validation_flags: failures, metrics });
  const assessment = assessReference(metrics, await loadProfiles(db), signId);

  const person: string = user.uuid;
  const trust: string = user.trust_level ?? "regular";
  const captureVersion = String(body.capture_version ?? "").slice(0, 40);
  const durationMs = Math.round(capture.timestamps[capture.frameCount - 1]);
  const rounded = Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [key, Math.round(value * 10000) / 10000]),
  ) as unknown as Metrics;
  const base = {
    uuid: person,
    sign_id: signId,
    sign_slug: sign.slug,
    schema_version: SCHEMA_VERSION,
    capture_version: captureVersion,
    client_id: clientId,
    frame_count: capture.frameCount,
    duration_ms: durationMs,
    ...rounded,
    active_hand: activeHand(capture),
    validation_flags: assessment.validation_flags,
    reference_similarity_score: assessment.reference_similarity_score,
    user_trust_level: trust,
    counts_as_reference: false,
    reviewed_by: null,
    reviewed_at: null,
  };
  const userRef = db.collection(USERS).doc(uid);

  // Step 1: reserve an index, or find the recording of an earlier try.
  const reserved = await transaction(db, async (t) => {
    const same = await t.get(db.collection(RECORDINGS).where("client_id", "==", clientId).limit(1));
    if (!same.empty) {
      const found = same.docs[0];
      if (found.get("uuid") !== person) throw new ApiError(409, "client_id_conflict");
      if (found.get("status") !== "uploading") return { done: true as const, id: found.id, data: found.data() };
      const age = Date.now() - (found.get("reserved_at") as Timestamp).toMillis();
      if (age < STALE_UPLOAD_MS) throw new ApiError(409, "upload_in_progress");
      t.update(found.ref, { reserved_at: Timestamp.now() });
      return { done: false as const, id: found.id, idx: found.get("video_idx") as number };
    }

    const signRecordings = { ...((await t.get(userRef)).get("sign_recordings") ?? {}) } as Record<string, number[]>;
    const used = new Set(signRecordings[signId] ?? []);
    for (let idx = 1; idx <= settings.targetPerSign; idx += 1) {
      if (used.has(idx)) continue;
      const ref = db.collection(RECORDINGS).doc(`${person}_${signId}_${String(idx).padStart(2, "0")}`);
      if ((await t.get(ref)).exists) continue;
      signRecordings[signId] = [...used, idx].sort((a, b) => a - b);
      t.update(userRef, { sign_recordings: signRecordings, updated_at: FieldValue.serverTimestamp() });
      t.set(ref, {
        ...base,
        video_idx: idx,
        path: `${sign.slug}/${person}/${String(idx).padStart(2, "0")}.npz`,
        status: "uploading",
        reserved_at: Timestamp.now(),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      return { done: false as const, id: ref.id, idx };
    }
    throw new ApiError(409, "sign_complete");
  });

  const recRef = db.collection(RECORDINGS).doc(reserved.id);
  if (reserved.done) return { recording: publicRecording(reserved.id, reserved.data), replay: null, duplicate: true };

  // Step 2: write the file. If this fails, release the index.
  const idx = reserved.idx;
  const filePath = `${sign.slug}/${person}/${String(idx).padStart(2, "0")}.npz`;
  try {
    await storage.put(filePath, writeNpz(capture, {
      capture_version: captureVersion,
      sign_id: signId,
      video_idx: idx,
      duration_ms: durationMs,
      video_width: clampInt(body.meta?.video_width, 0, 10000),
      video_height: clampInt(body.meta?.video_height, 0, 10000),
    }));
  } catch (error) {
    console.error("storage put failed", error);
    await transaction(db, async (t) => {
      const [rec, owner] = await t.getAll(recRef, userRef);
      if (rec.exists && rec.get("status") === "uploading") t.delete(recRef);
      const signRecordings = { ...(owner.get("sign_recordings") ?? {}) } as Record<string, number[]>;
      signRecordings[signId] = (signRecordings[signId] ?? []).filter((i) => i !== idx);
      t.update(userRef, { sign_recordings: signRecordings });
    });
    throw new ApiError(502, "storage_error");
  }

  // Step 3: confirm the recording and increase the counters.
  await transaction(db, async (t) => {
    const rec = await t.get(recRef);
    if (rec.get("status") !== "uploading") return;
    t.update(recRef, { status: defaultStatus(trust), updated_at: FieldValue.serverTimestamp() });
    t.update(userRef, { recording_count: FieldValue.increment(1) });
    t.update(signRef, { recording_count: FieldValue.increment(1) });
  });
  return {
    recording: publicRecording(reserved.id, (await recRef.get()).data()!),
    replay: replayPayload(capture),
    duplicate: false,
  };
}

async function visibleRecording(db: Firestore, id: string): Promise<Doc> {
  const snap = await db.collection(RECORDINGS).doc(id || "-").get();
  if (!snap.exists || snap.get("status") === "uploading") throw new ApiError(404, "recording_not_found");
  return snap.data()!;
}

export async function myRecordings(db: Firestore, user: Doc) {
  const snaps = await db.collection(RECORDINGS)
    .where("uuid", "==", user.uuid)
    .orderBy("created_at", "desc")
    .limit(500)
    .get();
  return snaps.docs.filter((s) => s.get("status") !== "uploading").map((s) => publicRecording(s.id, s.data()));
}

export async function replay(db: Firestore, storage: Storage, user: Doc, id: string) {
  const data = await visibleRecording(db, id);
  if (data.uuid !== user.uuid && !isReviewer(user)) throw new ApiError(404, "recording_not_found");
  const file = await storage.get(data.path);
  if (!file) throw new ApiError(404, "recording_file_missing");
  return { recording: publicRecording(id, data), ...replayPayload(readNpz(file).capture) };
}

export async function deleteOwn(db: Firestore, storage: Storage, uid: string, user: Doc, id: string) {
  const data = await visibleRecording(db, id);
  if (data.uuid !== user.uuid) throw new ApiError(404, "recording_not_found");
  await storage.delete(data.path);
  const recRef = db.collection(RECORDINGS).doc(id);
  const userRef = db.collection(USERS).doc(uid);
  await transaction(db, async (t) => {
    const [rec, owner] = await t.getAll(recRef, userRef);
    if (!rec.exists) return;
    const current = rec.data()!;
    const signRecordings = { ...(owner.get("sign_recordings") ?? {}) } as Record<string, number[]>;
    signRecordings[current.sign_id] = (signRecordings[current.sign_id] ?? []).filter((i) => i !== current.video_idx);
    t.delete(recRef);
    t.update(userRef, { sign_recordings: signRecordings, recording_count: FieldValue.increment(-1) });
    t.update(db.collection(SIGNS).doc(current.sign_id), {
      recording_count: FieldValue.increment(-1),
      accepted_count: FieldValue.increment(current.status === "accepted" ? -1 : 0),
      reference_count: FieldValue.increment(current.counts_as_reference ? -1 : 0),
    });
  });
}

// ---------- review ----------

async function uuidForUsername(db: Firestore, username: string): Promise<string | null> {
  let key: string;
  try {
    key = usernameKey(username);
  } catch {
    return null;
  }
  const name = await db.collection(USERNAMES).doc(key).get();
  if (!name.exists) return null;
  const owner = await db.collection(USERS).doc(name.get("uid")).get();
  return owner.exists ? owner.get("uuid") : null;
}

export interface ReviewQuery {
  status?: string;
  sign_id?: string;
  trust_level?: string;
  flag?: string;
  username?: string;
  cursor?: string;
  limit?: string;
}

export async function reviewList(db: Firestore, settings: Settings, user: Doc, params: ReviewQuery) {
  if (!params.status || !LISTABLE_STATUSES.includes(params.status)) throw new ApiError(422, "invalid_status");
  const filters = (["sign_id", "trust_level", "flag", "username"] as const).filter((key) => params[key]);
  if (filters.length > 1) throw new ApiError(422, "too_many_filters");

  let query = db.collection(RECORDINGS).where("status", "==", params.status);
  if (params.sign_id) query = query.where("sign_id", "==", params.sign_id);
  else if (params.trust_level) query = query.where("user_trust_level", "==", params.trust_level);
  else if (params.flag) query = query.where("validation_flags", "array-contains", params.flag);
  else if (params.username) {
    const person = await uuidForUsername(db, params.username);
    if (!person) return { items: [], next_cursor: null };
    query = query.where("uuid", "==", person);
  }
  query = query.orderBy("created_at", "desc");
  if (params.cursor) {
    const cursor = await db.collection(RECORDINGS).doc(params.cursor).get();
    if (!cursor.exists) throw new ApiError(422, "invalid_cursor");
    query = query.startAfter(cursor);
  }
  const limit = Math.max(1, Math.min(Number(params.limit) || settings.pageSize, settings.pageSize));
  const snaps = (await query.limit(limit).get()).docs;
  return {
    items: snaps.map((s) => ({ ...publicRecording(s.id, s.data()), is_own: s.get("uuid") === user.uuid })),
    next_cursor: snaps.length === limit ? snaps[snaps.length - 1].id : null,
  };
}

export async function reviewBatch(db: Firestore, uid: string, user: Doc, updates: unknown) {
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > MAX_REVIEW_BATCH) {
    throw new ApiError(422, "invalid_batch_size");
  }
  const wanted = new Map<string, string>();
  for (const item of updates as { id?: string; status?: string }[]) {
    if (!item || !["accepted", "rejected", "pending"].includes(String(item.status))) {
      throw new ApiError(422, "invalid_status");
    }
    wanted.set(String(item.id), String(item.status));
  }
  const refs = [...wanted.keys()].map((id) => db.collection(RECORDINGS).doc(id || "-"));

  await transaction(db, async (t) => {
    const snaps = await t.getAll(...refs);
    const deltas = new Map<string, { accepted: number; reference: number }>();
    for (const snap of snaps) {
      if (!snap.exists || snap.get("status") === "uploading") {
        throw new ApiError(404, "recording_not_found", { id: snap.id });
      }
      const current = snap.data()!;
      if (current.uuid === user.uuid) throw new ApiError(403, "cannot_review_own", { id: snap.id });
      const trust: string = current.user_trust_level ?? "regular";
      const choice = wanted.get(snap.id)!;
      const status = choice === "pending" ? defaultStatus(trust) : choice;
      const reference = countsAsReference(status, trust);
      const delta = deltas.get(current.sign_id) ?? { accepted: 0, reference: 0 };
      delta.accepted += Number(status === "accepted") - Number(current.status === "accepted");
      delta.reference += Number(reference) - Number(Boolean(current.counts_as_reference));
      deltas.set(current.sign_id, delta);
      t.update(snap.ref, {
        status,
        counts_as_reference: reference,
        reviewed_by: choice === "pending" ? null : uid,
        reviewed_at: choice === "pending" ? null : FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    for (const [signId, delta] of deltas) {
      if (delta.accepted === 0 && delta.reference === 0) continue;
      t.update(db.collection(SIGNS).doc(signId), {
        accepted_count: FieldValue.increment(delta.accepted),
        reference_count: FieldValue.increment(delta.reference),
      });
    }
  });
  const after = await db.getAll(...refs);
  return after.map((s) => publicRecording(s.id, s.data()!));
}

// ---------- administration ----------

export async function adminUsers(db: Firestore, username: string | undefined, cursor: string | undefined, pageSize: number) {
  if (username) {
    let key: string;
    try {
      key = usernameKey(username);
    } catch {
      return { items: [], next_cursor: null };
    }
    const name = await db.collection(USERNAMES).doc(key).get();
    if (!name.exists) return { items: [], next_cursor: null };
    const snap = await db.collection(USERS).doc(name.get("uid")).get();
    return { items: snap.exists ? [publicProfile(snap.id, snap.data()!)] : [], next_cursor: null };
  }
  let query = db.collection(USERS).orderBy("created_at", "desc");
  if (cursor) {
    const start = await db.collection(USERS).doc(cursor).get();
    if (!start.exists) throw new ApiError(422, "invalid_cursor");
    query = query.startAfter(start);
  }
  const snaps = (await query.limit(pageSize).get()).docs;
  return {
    items: snaps.map((s) => publicProfile(s.id, s.data())),
    next_cursor: snaps.length === pageSize ? snaps[snaps.length - 1].id : null,
  };
}

/** Copy the new trust level to the recordings of the person and adjust the counters. */
async function propagateTrust(db: Firestore, person: string, trust: string): Promise<void> {
  const snaps = await db.collection(RECORDINGS).where("uuid", "==", person).get();
  const deltas = new Map<string, number>();
  let batch = db.batch();
  let pending = 0;
  for (const snap of snaps.docs) {
    const current = snap.data();
    if (current.status === "uploading") continue;
    const status = PENDING.has(current.status) ? defaultStatus(trust) : current.status;
    const reference = countsAsReference(status, trust);
    deltas.set(
      current.sign_id,
      (deltas.get(current.sign_id) ?? 0) + Number(reference) - Number(Boolean(current.counts_as_reference)),
    );
    batch.update(snap.ref, {
      user_trust_level: trust,
      status,
      counts_as_reference: reference,
      updated_at: FieldValue.serverTimestamp(),
    });
    pending += 1;
    if (pending === 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  for (const [signId, delta] of deltas) {
    if (delta !== 0) batch.update(db.collection(SIGNS).doc(signId), { reference_count: FieldValue.increment(delta) });
  }
  await batch.commit();
}

export async function adminUpdateUser(db: Firestore, adminUid: string, uid: string, changes: Doc) {
  const ref = db.collection(USERS).doc(uid || "-");
  const current = (await ref.get()).data();
  if (!current) throw new ApiError(404, "user_not_found");
  const fields: Doc = {};
  if (changes.role !== undefined) {
    if (!["user", "admin"].includes(changes.role)) throw new ApiError(422, "invalid_role");
    if (uid === adminUid && changes.role !== "admin") throw new ApiError(409, "cannot_remove_own_admin");
    fields.role = changes.role;
  }
  if (changes.trust_level !== undefined) {
    if (!TRUST_LEVELS.includes(changes.trust_level)) throw new ApiError(422, "invalid_trust_level");
    if (changes.trust_level !== current.trust_level) fields.trust_level = changes.trust_level;
  }
  if (Object.keys(fields).length > 0) await ref.update({ ...fields, updated_at: FieldValue.serverTimestamp() });
  if (fields.trust_level) await propagateTrust(db, current.uuid, fields.trust_level);
  return publicProfile(uid, (await ref.get()).data()!);
}

export async function createSign(db: Firestore, body: Doc) {
  const config = await catalogConfig(db);
  const name = String(body.name ?? "").trim();
  const videoUrl = String(body.video_url ?? "").trim();
  if (!name || !videoUrl.startsWith("https://")) throw new ApiError(422, "invalid_sign");
  const slug = named(() => slugify(name));
  const metadata = named(() => normalizeMetadata(body.sign_metadata, config.sign_metadata_schema));
  const same = await db.collection(SIGNS).where("slug", "==", slug).limit(1).get();
  if (!same.empty) throw new ApiError(409, "slug_taken", { slug });
  const ref = db.collection(SIGNS).doc(randomUUID());
  await ref.set({
    slug,
    name,
    video_url: videoUrl,
    metadata,
    active: true,
    order: Math.round(Number(body.order) || 0),
    recording_count: 0,
    accepted_count: 0,
    reference_count: 0,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  return publicSign(ref.id, (await ref.get()).data()!);
}

export async function updateSign(db: Firestore, signId: string, body: Doc) {
  const ref = db.collection(SIGNS).doc(signId || "-");
  if (!(await ref.get()).exists) throw new ApiError(404, "sign_not_found");
  const fields: Doc = {};
  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError(422, "invalid_sign");
    fields.name = name;
  }
  if ("video_url" in body) {
    if (!String(body.video_url ?? "").startsWith("https://")) throw new ApiError(422, "invalid_sign");
    fields.video_url = body.video_url;
  }
  if ("sign_metadata" in body) {
    const schema = (await catalogConfig(db)).sign_metadata_schema;
    fields.metadata = named(() => normalizeMetadata(body.sign_metadata, schema));
  }
  if ("active" in body) fields.active = Boolean(body.active);
  if ("order" in body) fields.order = Math.round(Number(body.order) || 0);
  if (Object.keys(fields).length > 0) await ref.update({ ...fields, updated_at: FieldValue.serverTimestamp() });
  return publicSign(signId, (await ref.get()).data()!);
}

export async function updateMetadataSchema(db: Firestore, schema: unknown) {
  const valid = named(() => validateMetadataSchema(schema));
  const config = await catalogConfig(db);
  const major = Number(String(config.schema_version).split(".")[0]) || 1;
  await db.collection(CONFIG).doc("sign_catalog").set({
    schema_version: `${major + 1}.0`,
    sign_metadata_schema: valid,
  });
  const batch = db.batch();
  for (const snap of (await db.collection(SIGNS).get()).docs) {
    const current = (snap.get("metadata") ?? {}) as Record<string, boolean>;
    batch.update(snap.ref, {
      metadata: Object.fromEntries(Object.keys(valid).map((key) => [key, Boolean(current[key])])),
    });
  }
  await batch.commit();
  return catalog(db, true);
}

export async function rebuildReferenceProfiles(db: Firestore, storage: Storage, minReferences: number) {
  const snaps = await db.collection(RECORDINGS).where("counts_as_reference", "==", true).get();
  const grouped = new Map<string, Metrics[]>();
  const errors: { id: string; error: string }[] = [];
  for (const snap of snaps.docs) {
    try {
      const file = await storage.get(snap.get("path"));
      if (!file) throw new Error("file_missing");
      const list = grouped.get(snap.get("sign_id")) ?? [];
      list.push(recordingMetrics(readNpz(file).capture));
      grouped.set(snap.get("sign_id"), list);
    } catch (error) {
      // One bad file does not stop the others.
      errors.push({ id: snap.id, error: (error as Error).message });
    }
  }
  const data = {
    schema_version: "1.0",
    min_references: minReferences,
    profiles: Object.fromEntries([...grouped].sort().map(([signId, list]) => [signId, buildProfile(list)])),
    build: {
      source_rule: "status=accepted and user_trust_level=expert",
      reference_samples: snaps.size,
      usable_reference_samples: [...grouped.values()].reduce((sum, list) => sum + list.length, 0),
      errors,
      built_at: new Date().toISOString(),
    },
  };
  await db.collection(CONFIG).doc("reference_profiles").set(data);
  clearCaches();
  return data;
}
