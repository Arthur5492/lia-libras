// Storage for `.npz` files: a local folder (for tests) or the HF bucket.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { deleteFile, downloadFile, uploadFile } from "@huggingface/hub";
import { getSettings } from "./settings";

export interface Storage {
  put(filePath: string, data: Uint8Array): Promise<void>;
  /** Return null when the file does not exist. */
  get(filePath: string): Promise<Uint8Array | null>;
  delete(filePath: string): Promise<void>;
}

function checkPath(filePath: string): string {
  const parts = filePath.split("/");
  if (!filePath || parts.some((p) => p === "" || p === "." || p === ".." || p.includes("\\"))) {
    throw new Error(`Path is not valid: ${filePath}`);
  }
  return filePath;
}

export class LocalStorage implements Storage {
  constructor(private root: string) {}

  private file(filePath: string): string {
    return path.join(this.root, ...checkPath(filePath).split("/"));
  }

  async put(filePath: string, data: Uint8Array): Promise<void> {
    const target = this.file(filePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async get(filePath: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.file(filePath)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(filePath: string): Promise<void> {
    await rm(this.file(filePath), { force: true });
  }
}

export class HfBucketStorage implements Storage {
  private repo: `buckets/${string}`;

  constructor(bucket: string, private token: string | undefined) {
    if (!bucket) throw new Error("LIA_HF_BUCKET is not set");
    if (!token) throw new Error("HF_TOKEN is not set");
    this.repo = `buckets/${bucket}`;
  }

  async put(filePath: string, data: Uint8Array): Promise<void> {
    await uploadFile({
      repo: this.repo,
      accessToken: this.token,
      file: { path: checkPath(filePath), content: new Blob([data as BlobPart]) },
    });
  }

  async get(filePath: string): Promise<Uint8Array | null> {
    const blob = await downloadFile({ repo: this.repo, accessToken: this.token, path: checkPath(filePath) });
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  async delete(filePath: string): Promise<void> {
    try {
      await deleteFile({ repo: this.repo, accessToken: this.token!, path: checkPath(filePath) });
    } catch (error) {
      // A file that is already absent is not an error for a delete.
      if ((error as { statusCode?: number }).statusCode !== 404) throw error;
    }
  }
}

let cached: Storage | undefined;

export function getStorage(): Storage {
  if (cached) return cached;
  const settings = getSettings();
  if (settings.storageMode === "hf") cached = new HfBucketStorage(settings.hfBucket, settings.hfToken);
  else if (settings.storageMode === "local") cached = new LocalStorage(settings.localBucket);
  else throw new Error(`LIA_STORAGE is not valid: ${settings.storageMode}`);
  return cached;
}

/** For tests only. */
export function setStorage(storage: Storage | undefined): void {
  cached = storage;
}
