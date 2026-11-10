// Firebase Admin: Firestore client and sign-in token check.
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { getSettings } from "./settings.js";

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

// Google publishes the keys that sign Firebase ID tokens.
// The check uses `jose`, because the auth module of firebase-admin loads an ES module with require().
const KEYS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

/** Return the uid of a valid ID token. Throws if the token is not valid. */
export async function verifyToken(token: string): Promise<string> {
  const settings = getSettings();
  // The Auth emulator signs no tokens. Use this only with the emulator and without real credentials.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST && !settings.serviceAccountJson) {
    const claims = decodeJwt(token);
    if (claims.aud !== settings.projectId || !claims.sub) throw new Error("bad emulator token");
    return claims.sub;
  }
  const { payload } = await jwtVerify(token, KEYS, {
    issuer: `https://securetoken.google.com/${settings.projectId}`,
    audience: settings.projectId,
    algorithms: ["RS256"],
  });
  if (!payload.sub) throw new Error("token has no subject");
  return payload.sub;
}
