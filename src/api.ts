import type { UploadBody } from "../shared/capture";
import { auth } from "./firebase";
import { messageFor } from "./messages";
import type { ReplayData } from "./replay/draw";

export type TrustLevel = "regular" | "trusted" | "expert";

export interface Profile {
  uid: string;
  uuid: string;
  username: string;
  role: "user" | "admin";
  trust_level: TrustLevel;
  show_in_ranking: boolean;
  consent_version: string;
  recording_count: number;
  sign_recordings: Record<string, number[]>;
}

export interface Sign {
  id: string;
  slug: string;
  name: string;
  video_url: string;
  sign_metadata: Record<string, boolean>;
  order: number;
  active: boolean;
  recording_count: number;
}

export type MetadataSchema = Record<string, { type: "boolean"; label: string }>;

export interface Catalog {
  schema_version: string;
  sign_metadata_schema: MetadataSchema;
  signs: Sign[];
}

export interface SignInput {
  name: string;
  video_url: string;
  sign_metadata: Record<string, boolean>;
  order: number;
  active?: boolean;
}

export interface Recording {
  id: string;
  sign_id: string;
  video_idx: number;
  status: string;
  frame_count: number;
  validation_flags: string[];
  created_at?: string | null;
}

export interface NextSigns {
  target_per_sign: number;
  remaining_signs: number;
  signs: Sign[];
}

export interface Stats {
  total_recordings: number;
  accepted_recordings: number;
  ranking: { username: string; recording_count: number }[];
}

/** API error. `code` is stable; see contract/api.md. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const user = auth.currentUser;
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "network_error");
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.code ?? "unknown_error", data);
  return data as T;
}

export const api = {
  me: () => request<Profile>("GET", "/api/me"),
  register: (username: string, consentVersion: string, showInRanking: boolean) =>
    request<Profile>("POST", "/api/me", {
      username,
      consent_version: consentVersion,
      show_in_ranking: showInRanking,
    }),
  updateMe: (showInRanking: boolean) => request<Profile>("PATCH", "/api/me", { show_in_ranking: showInRanking }),
  usernameAvailable: (username: string) =>
    request<{ username_key: string; available: boolean }>(
      "GET",
      `/api/usernames/${encodeURIComponent(username)}/available`,
    ),
  signs: () => request<{ signs: Sign[] }>("GET", "/api/signs"),
  stats: () => request<Stats>("GET", "/api/stats"),
  nextSigns: (count = 5) => request<NextSigns>("GET", `/api/collect/next?count=${count}`),
  upload: (body: UploadBody) =>
    request<{ recording: Recording; duplicate: boolean }>("POST", "/api/recordings", body),
  myRecordings: () => request<{ items: Recording[] }>("GET", "/api/me/recordings"),
  replay: (id: string) => request<ReplayData & { recording: Recording }>("GET", `/api/recordings/${id}/replay`),
  deleteRecording: (id: string) => request<void>("DELETE", `/api/me/recordings/${id}`),
  adminSigns: () => request<Catalog>("GET", "/api/admin/signs"),
  createSign: (input: SignInput) => request<Sign>("POST", "/api/admin/signs", input),
  updateSign: (id: string, input: Partial<SignInput>) => request<Sign>("PATCH", `/api/admin/signs/${id}`, input),
};

/** Message for the person, from an error. The texts are in messages.ts. */
export function errorMessage(error: unknown): string {
  return messageFor(error instanceof ApiError ? error.code : "unknown_error");
}
