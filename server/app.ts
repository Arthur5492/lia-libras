// API routes. All writes to Firestore and to the bucket go through this module. See contract/api.md.
import { Hono, type Context } from "hono";
import { ApiError } from "./errors.js";
import { getDb, verifyToken } from "./firebase.js";
import * as s from "./services.js";
import { getSettings } from "./settings.js";
import { getStorage } from "./storage.js";

interface Caller {
  uid: string;
  user: s.Doc;
}

type Env = { Variables: { uid: string; caller: Caller } };

const PUBLIC_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

export const app = new Hono<Env>().basePath("/api");

app.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ code: error.code, ...error.extra }, error.status);
  console.error(error);
  return c.json({ code: "internal_error" }, 500);
});
app.notFound((c) => c.json({ code: "not_found" }, 404));

async function uidOf(c: Context<Env>): Promise<string> {
  const header = c.req.header("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw new ApiError(401, "missing_token");
  try {
    return await verifyToken(header.slice(7).trim());
  } catch {
    throw new ApiError(401, "invalid_token");
  }
}

async function callerOf(c: Context<Env>): Promise<Caller> {
  const uid = await uidOf(c);
  const user = (await getDb().collection("users").doc(uid).get()).data();
  if (!user) throw new ApiError(403, "not_registered");
  return { uid, user };
}

async function reviewerOf(c: Context<Env>): Promise<Caller> {
  const caller = await callerOf(c);
  if (!s.isReviewer(caller.user)) throw new ApiError(403, "reviewer_only");
  return caller;
}

async function adminOf(c: Context<Env>): Promise<Caller> {
  const caller = await callerOf(c);
  if (!s.isAdmin(caller.user)) throw new ApiError(403, "admin_only");
  return caller;
}

async function bodyOf(c: Context<Env>): Promise<Record<string, any>> {
  try {
    const body = await c.req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("not an object");
    return body;
  } catch {
    throw new ApiError(422, "invalid_json");
  }
}

// ---------- public ----------

app.get("/health", (c) => c.json({ ok: true, storage: getSettings().storageMode }));

app.get("/signs", async (c) => {
  c.header("Cache-Control", PUBLIC_CACHE);
  return c.json(await s.catalog(getDb()));
});

app.get("/stats", async (c) => {
  c.header("Cache-Control", PUBLIC_CACHE);
  return c.json(await s.stats(getDb()));
});

// ---------- profile ----------

app.get("/usernames/:username/available", async (c) => {
  await uidOf(c);
  return c.json(await s.usernameAvailable(getDb(), c.req.param("username")));
});

app.get("/me", async (c) => {
  const caller = await callerOf(c);
  return c.json(s.publicProfile(caller.uid, caller.user));
});

app.post("/me", async (c) => {
  const uid = await uidOf(c);
  const body = await bodyOf(c);
  const profile = await s.register(
    getDb(), uid, String(body.username ?? ""), Boolean(body.show_in_ranking), String(body.consent_version ?? ""),
  );
  return c.json(profile, 201);
});

app.patch("/me", async (c) => {
  const caller = await callerOf(c);
  const body = await bodyOf(c);
  return c.json(await s.updateMe(getDb(), caller.uid, Boolean(body.show_in_ranking)));
});

// ---------- recordings ----------

app.get("/collect/next", async (c) => {
  const caller = await callerOf(c);
  return c.json(await s.nextSigns(getDb(), getSettings(), caller.user, Number(c.req.query("count")) || 5));
});

app.post("/recordings", async (c) => {
  const caller = await callerOf(c);
  const result = await s.upload(getDb(), getStorage(), getSettings(), caller.uid, caller.user, await bodyOf(c));
  return c.json(result, result.duplicate ? 200 : 201);
});

app.get("/me/recordings", async (c) => {
  const caller = await callerOf(c);
  return c.json({ items: await s.myRecordings(getDb(), caller.user) });
});

app.get("/recordings/:id/replay", async (c) => {
  const caller = await callerOf(c);
  c.header("Cache-Control", "private, max-age=300");
  return c.json(await s.replay(getDb(), getStorage(), caller.user, c.req.param("id")));
});

app.delete("/me/recordings/:id", async (c) => {
  const caller = await callerOf(c);
  await s.deleteOwn(getDb(), getStorage(), caller.uid, caller.user, c.req.param("id"));
  return c.body(null, 204);
});

// ---------- review ----------

app.get("/review/recordings", async (c) => {
  const caller = await reviewerOf(c);
  return c.json(await s.reviewList(getDb(), getSettings(), caller.user, c.req.query()));
});

app.patch("/review/recordings", async (c) => {
  const caller = await reviewerOf(c);
  const body = await bodyOf(c);
  return c.json({ items: await s.reviewBatch(getDb(), caller.uid, caller.user, body.updates) });
});

// ---------- administration ----------

app.get("/admin/users", async (c) => {
  await adminOf(c);
  return c.json(await s.adminUsers(getDb(), c.req.query("username"), c.req.query("cursor"), getSettings().pageSize));
});

app.patch("/admin/users/:uid", async (c) => {
  const caller = await adminOf(c);
  return c.json(await s.adminUpdateUser(getDb(), caller.uid, c.req.param("uid"), await bodyOf(c)));
});

app.get("/admin/signs", async (c) => {
  await adminOf(c);
  return c.json(await s.catalog(getDb(), true));
});

app.post("/admin/signs", async (c) => {
  await adminOf(c);
  return c.json(await s.createSign(getDb(), await bodyOf(c)), 201);
});

app.patch("/admin/signs/:id", async (c) => {
  await adminOf(c);
  return c.json(await s.updateSign(getDb(), c.req.param("id"), await bodyOf(c)));
});

app.put("/admin/sign-metadata-schema", async (c) => {
  await adminOf(c);
  return c.json(await s.updateMetadataSchema(getDb(), (await bodyOf(c)).sign_metadata_schema));
});

app.get("/admin/reference-profiles", async (c) => {
  await adminOf(c);
  return c.json(await s.loadProfiles(getDb()));
});

app.post("/admin/reference-profiles/rebuild", async (c) => {
  await adminOf(c);
  const body = await bodyOf(c);
  const minimum = Number(body.min_references) || getSettings().minReferenceCount;
  return c.json(await s.rebuildReferenceProfiles(getDb(), getStorage(), minimum));
});
