import { auth } from "./firebase";

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
};

const MESSAGES: Record<string, string> = {
  network_error: "Sem conexão. Verifique a internet e tente de novo.",
  invalid_username: "Use de 3 a 20 letras, números ou _ (sem espaços).",
  blocked_username: "Esse nome não pode ser usado. Escolha outro.",
  username_taken: "Esse nome já está em uso. Escolha outro.",
  already_registered: "Esta conta já tem cadastro.",
  consent_required: "Aceite o termo para continuar.",
  busy_retry: "O servidor está ocupado. Tente de novo.",
  invalid_token: "Sua sessão expirou. Entre de novo.",
};

/** Message in Portuguese for the person, from an error code. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? `Algo deu errado (${error.code}). Tente de novo.`;
  return "Algo deu errado. Tente de novo.";
}
