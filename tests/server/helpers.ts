// Test helpers: synthetic captures and access to the emulators.
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  emptyHand, encodeCapture, HAND_DIMS, HAND_POINTS, LABEL_LEFT, LABEL_RIGHT, LEFT, POSE_DIMS, POSE_POINTS, RIGHT,
  WORLD_DIMS, type Capture, type UploadBody,
} from "../../shared/capture";
import { app } from "../../server/app";
import { getDb } from "../../server/firebase";
import { clearCaches } from "../../server/services";
import { LocalStorage, setStorage } from "../../server/storage";

export const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
const PROJECT = process.env.GCLOUD_PROJECT || "demo-libras";
process.env.LIA_FIREBASE_PROJECT_ID = PROJECT;

export const bucketDir = mkdtempSync(path.join(tmpdir(), "libras-test-bucket-"));

const LEFT_WRIST: [number, number] = [0.65, 0.6];
const RIGHT_WRIST: [number, number] = [0.35, 0.6];
const HAND_FRAME = HAND_POINTS * HAND_DIMS;

export interface CaptureOptions {
  frames?: number;
  poseMissing?: number;
  handMissing?: number;
  swapChannels?: boolean;
  twoHands?: boolean;
  still?: boolean;
}

/** Make a moving right hand (pose wrist 16) and, as an option, a static left hand. */
export function makeCapture(options: CaptureOptions = {}): Capture {
  const n = options.frames ?? 40;
  const capture: Capture = {
    frameCount: n,
    timestamps: Float32Array.from({ length: n }, (_, i) => i * 50),
    pose: new Float32Array(n * POSE_POINTS * POSE_DIMS),
    poseWorld: new Float32Array(n * POSE_POINTS * WORLD_DIMS),
    poseMask: new Uint8Array(n),
    hands: [emptyHand(n), emptyHand(n)],
  };
  const setHand = (channel: number, i: number, x: number, y: number, label: number) => {
    const hand = capture.hands[channel];
    for (let j = 0; j < HAND_POINTS; j += 1) {
      hand.image.set([x + 0.01 * (j % 5), y - 0.01 * Math.floor(j / 5), 0], i * HAND_FRAME + j * HAND_DIMS);
      hand.world.set([0.01 * (j % 5), 0.01 * Math.floor(j / 5), 0], i * HAND_FRAME + j * HAND_DIMS);
    }
    hand.mask[i] = 1;
    hand.labels[i] = label;
    hand.scores[i] = 0.9;
  };
  for (let i = 0; i < n; i += 1) {
    const dx = options.still ? 0 : 0.004 * i;
    if (i >= (options.poseMissing ?? 0)) {
      capture.poseMask[i] = 1;
      for (let j = 0; j < POSE_POINTS; j += 1) capture.pose.set([0.5, 0.5, 0, 0.99], (i * POSE_POINTS + j) * POSE_DIMS);
      capture.pose.set([...LEFT_WRIST, 0, 0.99], (i * POSE_POINTS + 15) * POSE_DIMS);
      capture.pose.set([RIGHT_WRIST[0] + dx, RIGHT_WRIST[1], 0, 0.99], (i * POSE_POINTS + 16) * POSE_DIMS);
    }
    // The detector puts each hand in the channel of its label. With swap, the label is wrong.
    const moving = options.swapChannels ? LEFT : RIGHT;
    const other = options.swapChannels ? RIGHT : LEFT;
    if (i >= (options.handMissing ?? 0)) {
      setHand(moving, i, RIGHT_WRIST[0] + dx, RIGHT_WRIST[1], moving === LEFT ? LABEL_LEFT : LABEL_RIGHT);
    }
    if (options.twoHands) setHand(other, i, ...LEFT_WRIST, other === LEFT ? LABEL_LEFT : LABEL_RIGHT);
  }
  return capture;
}

export function makeBody(signId: string, options: CaptureOptions = {}, clientId?: string): UploadBody {
  return {
    client_id: clientId ?? randomUUID(),
    sign_id: signId,
    capture_version: "test",
    meta: { duration_ms: 2000, video_width: 640, video_height: 480 },
    ...encodeCapture(makeCapture(options)),
  };
}

// ---------- emulators ----------

export async function resetEmulators(): Promise<void> {
  const firestore = process.env.FIRESTORE_EMULATOR_HOST;
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  await fetch(`http://${firestore}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${auth}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  clearCaches();
  setStorage(new LocalStorage(bucketDir));
}

export class Person {
  uuid = "";
  constructor(public uid: string, private token: string) {}

  async call(method: string, url: string, body?: unknown): Promise<{ status: number; body: any; headers: Headers }> {
    const response = await app.request(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  }

  get = (url: string) => this.call("GET", url);
  post = (url: string, body?: unknown) => this.call("POST", url, body ?? {});
  patch = (url: string, body?: unknown) => this.call("PATCH", url, body ?? {});
  put = (url: string, body?: unknown) => this.call("PUT", url, body ?? {});
  delete = (url: string) => this.call("DELETE", url);
}

/** Create an account in the Auth emulator. The person has no profile yet. */
export async function signUp(): Promise<Person> {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${randomUUID()}@example.com`, password: "test-password", returnSecureToken: true }),
    },
  );
  const data = (await response.json()) as { localId: string; idToken: string };
  return new Person(data.localId, data.idToken);
}

let counter = 0;

/** Create and register a person. Set the trust level and role directly in the database. */
export async function person(trustLevel = "regular", role = "user", showInRanking = false): Promise<Person> {
  const p = await signUp();
  counter += 1;
  const response = await p.post("/api/me", {
    username: `pessoa_${counter}`,
    consent_version: "v1",
    show_in_ranking: showInRanking,
  });
  if (response.status !== 201) throw new Error(`registration failed: ${JSON.stringify(response.body)}`);
  p.uuid = response.body.uuid;
  if (trustLevel !== "regular" || role !== "user") {
    await getDb().collection("users").doc(p.uid).update({ trust_level: trustLevel, role });
  }
  return p;
}

export function resetCounter(): void {
  counter = 0;
}

export async function sign(slug = "amor", active = true): Promise<string> {
  const id = randomUUID();
  await getDb().collection("signs").doc(id).set({
    slug, name: slug, video_url: "https://example.com/v.mp4", metadata: {}, active, order: 0,
    recording_count: 0, accepted_count: 0, reference_count: 0,
  });
  return id;
}

export async function doc(collection: string, id: string): Promise<any> {
  return (await getDb().collection(collection).doc(id).get()).data();
}
