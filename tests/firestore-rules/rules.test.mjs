// Tests for the Firestore rules. Run with:
//   npx firebase emulators:exec --only firestore "npm --prefix tests/firestore-rules test"
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-libras",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alice"), { uuid: "u-alice", trust_level: "regular", role: "user" });
    await setDoc(doc(db, "users/bob"), { uuid: "u-bob", trust_level: "trusted", role: "user" });
    await setDoc(doc(db, "usernames/alice"), { uid: "alice" });
    await setDoc(doc(db, "recordings/u-alice_s1_01"), { uuid: "u-alice", status: "unreviewed" });
    await setDoc(doc(db, "signs/s1"), { slug: "amor", active: true });
    await setDoc(doc(db, "config/reference_profiles"), { profiles: {} });
  });
});

const alice = () => env.authenticatedContext("alice").firestore();
const anon = () => env.unauthenticatedContext().firestore();

test("reads own profile", async () => {
  await assertSucceeds(getDoc(doc(alice(), "users/alice")));
});

test("cannot read the profile of another person", async () => {
  await assertFails(getDoc(doc(alice(), "users/bob")));
});

test("cannot list users", async () => {
  await assertFails(getDocs(collection(alice(), "users")));
});

test("cannot change own trust level", async () => {
  await assertFails(updateDoc(doc(alice(), "users/alice"), { trust_level: "expert" }));
});

test("cannot create own profile or reserve a username", async () => {
  const db = env.authenticatedContext("carol").firestore();
  await assertFails(setDoc(doc(db, "users/carol"), { uuid: "x", trust_level: "expert" }));
  await assertFails(setDoc(doc(db, "usernames/carol"), { uid: "carol" }));
});

test("cannot read anything without sign-in", async () => {
  await assertFails(getDoc(doc(anon(), "users/alice")));
  await assertFails(getDoc(doc(anon(), "signs/s1")));
});

test("cannot read or write recordings, signs, usernames or config", async () => {
  const db = alice();
  for (const path of ["recordings/u-alice_s1_01", "signs/s1", "usernames/alice", "config/reference_profiles"]) {
    await assertFails(getDoc(doc(db, path)));
    await assertFails(setDoc(doc(db, path), { x: 1 }));
  }
});
