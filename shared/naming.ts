// Usernames, slugs and sign metadata.

const USERNAME_DISPLAY = /^[\p{L}\p{N}_]{3,20}$/u;
const USERNAME_KEY = /^[a-z0-9_]{3,20}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const METADATA_KEY = /^[a-z][a-z0-9_]*$/;
const RESERVED = new Set([
  "admin", "administrador", "api", "lia", "libras", "moderador", "null",
  "root", "sistema", "suporte", "undefined", "anonimo",
]);

export class NamingError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function toAscii(text: string): string {
  return text.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
}

/** Validate the username and return the unique key (lowercase, no accents). */
export function usernameKey(display: string, blockedTerms: string[] = []): string {
  const name = (display ?? "").trim();
  if (!USERNAME_DISPLAY.test(name)) throw new NamingError("invalid_username");
  const key = toAscii(name).toLowerCase();
  if (!USERNAME_KEY.test(key)) throw new NamingError("invalid_username");
  if (RESERVED.has(key)) throw new NamingError("blocked_username");
  if (blockedTerms.some((term) => term && key.includes(term))) throw new NamingError("blocked_username");
  return key;
}

export function slugify(name: string): string {
  const slug = toAscii(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!SLUG.test(slug)) throw new NamingError("invalid_sign_name");
  return slug;
}

export type MetadataSchema = Record<string, { type: "boolean"; label: string }>;

export function validateMetadataSchema(schema: unknown): MetadataSchema {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new NamingError("invalid_metadata_schema");
  }
  const valid: MetadataSchema = {};
  for (const [key, field] of Object.entries(schema as Record<string, unknown>)) {
    if (!METADATA_KEY.test(key) || typeof field !== "object" || field === null) {
      throw new NamingError("invalid_metadata_schema");
    }
    const { type = "boolean", label } = field as { type?: string; label?: string };
    if (type !== "boolean") throw new NamingError("invalid_metadata_schema");
    valid[key] = { type: "boolean", label: String(label || key.replace(/_/g, " ")).trim() };
  }
  return valid;
}

export function normalizeMetadata(metadata: unknown, schema: MetadataSchema): Record<string, boolean> {
  const source = metadata ?? {};
  if (typeof source !== "object" || Array.isArray(source)) throw new NamingError("invalid_sign_metadata");
  const normalized: Record<string, boolean> = {};
  for (const key of Object.keys(schema)) {
    const value = (source as Record<string, unknown>)[key] ?? false;
    if (typeof value !== "boolean") throw new NamingError("invalid_sign_metadata");
    normalized[key] = value;
  }
  return normalized;
}
