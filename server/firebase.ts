// Firebase Admin: Firestore client and sign-in token check.
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getSettings } from "./settings";

function getApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const settings = getSettings();
  if (settings.serviceAccountJson) {
    return initializeApp({ credential: cert(JSON.parse(settings.serviceAccountJson)), projectId: settings.projectId });
  }
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    return initializeApp({ projectId: settings.projectId });
  }
  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
}

let db: Firestore | undefined;

export function getDb(): Firestore {
  if (!db) {
    db = getFirestore(getApp());
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
}

/** Return the uid of a valid ID token. Throws if the token is not valid. */
export async function verifyToken(token: string): Promise<string> {
  return (await getAuth(getApp()).verifyIdToken(token)).uid;
}
