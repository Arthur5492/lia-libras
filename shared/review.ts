// Codes for the reason that a reviewer gives when a recording is rejected.
// The API stores the code only. The site shows the text for each code.
export const REJECTION_REASONS = [
  "wrong_sign",
  "hands_not_visible",
  "body_not_visible",
  "incomplete_motion",
  "other",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export function isRejectionReason(value: unknown): value is RejectionReason {
  return typeof value === "string" && (REJECTION_REASONS as readonly string[]).includes(value);
}
