// Testes das regras do Firestore. Rodar com:
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

test("lê o próprio perfil", async () => {
  await assertSucceeds(getDoc(doc(alice(), "users/alice")));
});

test("não lê o perfil de outra pessoa", async () => {
  await assertFails(getDoc(doc(alice(), "users/bob")));
});

test("não lista usuários", async () => {
  await assertFails(getDocs(collection(alice(), "users")));
});

test("não altera o próprio nível", async () => {
  await assertFails(updateDoc(doc(alice(), "users/alice"), { trust_level: "expert" }));
});

test("não cria o próprio perfil nem reserva username", async () => {
  const db = env.authenticatedContext("carol").firestore();
  await assertFails(setDoc(doc(db, "users/carol"), { uuid: "x", trust_level: "expert" }));
  await assertFails(setDoc(doc(db, "usernames/carol"), { uid: "carol" }));
});

test("sem login não lê nada", async () => {
  await assertFails(getDoc(doc(anon(), "users/alice")));
  await assertFails(getDoc(doc(anon(), "signs/s1")));
});

test("não lê nem escreve gravações, sinais, usernames e config", async () => {
  const db = alice();
  for (const path of ["recordings/u-alice_s1_01", "signs/s1", "usernames/alice", "config/reference_profiles"]) {
    await assertFails(getDoc(doc(db, path)));
    await assertFails(setDoc(doc(db, path), { x: 1 }));
  }
});
