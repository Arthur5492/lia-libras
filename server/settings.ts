// Settings from environment variables. See .env.example.

export interface Settings {
  projectId: string;
  serviceAccountJson: string | undefined;
  storageMode: string;
  localBucket: string;
  hfBucket: string;
  hfToken: string | undefined;
  targetPerSign: number;
  minReferenceCount: number;
  pageSize: number;
}

export function getSettings(): Settings {
  const env = process.env;
  return {
    projectId: env.LIA_FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || "demo-libras",
    serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
    storageMode: env.LIA_STORAGE || "local",
    localBucket: env.LIA_LOCAL_BUCKET || "local_bucket",
    hfBucket: env.LIA_HF_BUCKET || "",
    hfToken: env.HF_TOKEN,
    targetPerSign: Number(env.LIA_TARGET_PER_SIGN || 4),
    minReferenceCount: Number(env.LIA_MIN_REFERENCE_COUNT || 3),
    pageSize: Number(env.LIA_PAGE_SIZE || 50),
  };
}
