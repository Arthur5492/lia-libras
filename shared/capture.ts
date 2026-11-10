// In-memory form of one recording. The site and the API use the same code.
// See contract/npz.md for the stored format.

export const POSE_POINTS = 33;
export const HAND_POINTS = 21;
export const POSE_DIMS = 4; // x, y, z, visibility
export const WORLD_DIMS = 3;
export const HAND_DIMS = 3;
export const MIN_FRAMES = 15;
export const MAX_FRAMES = 150;
export const MAX_DURATION_MS = 4000;
export const SCHEMA_VERSION = "2.0";

export const LEFT = 0;
export const RIGHT = 1;

/** Detector label codes in `labels`. */
export const LABEL_NONE = 0;
export const LABEL_LEFT = 1;
export const LABEL_RIGHT = 2;

export interface HandChannel {
  image: Float32Array; // n * 21 * 3, image coordinates
  world: Float32Array; // n * 21 * 3, meters
  mask: Uint8Array; // n
  labels: Uint8Array; // n, original detector label
  scores: Float32Array; // n, detector confidence for the label
}

export interface Capture {
  frameCount: number;
  timestamps: Float32Array; // n, milliseconds from the first frame
  pose: Float32Array; // n * 33 * 4
  poseWorld: Float32Array; // n * 33 * 3
  poseMask: Uint8Array; // n
  hands: [HandChannel, HandChannel]; // LEFT, RIGHT
}

export function emptyHand(frameCount: number): HandChannel {
  return {
    image: new Float32Array(frameCount * HAND_POINTS * HAND_DIMS),
    world: new Float32Array(frameCount * HAND_POINTS * HAND_DIMS),
    mask: new Uint8Array(frameCount),
    labels: new Uint8Array(frameCount),
    scores: new Float32Array(frameCount),
  };
}

// ---------- base64 transport ----------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function floatsToBase64(values: Float32Array): string {
  return bytesToBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

/** Little-endian float32 values. Copies the bytes, so the alignment is always correct. */
export function base64ToFloats(text: string): Float32Array {
  const bytes = base64ToBytes(text);
  if (bytes.length % 4 !== 0) throw new Error("bad float32 length");
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** JSON body of `POST /api/recordings`. See contract/api.md. */
export interface UploadBody {
  client_id: string;
  sign_id: string;
  capture_version: string;
  meta: { duration_ms: number; video_width: number; video_height: number };
  frame_count: number;
  timestamps_ms: string;
  pose: string;
  pose_world: string;
  pose_mask: string;
  left_hand: string;
  left_hand_world: string;
  left_mask: string;
  right_hand: string;
  right_hand_world: string;
  right_mask: string;
  hand_labels: string; // n * 2 bytes, [left, right] for each frame
  hand_scores: string; // n * 2 floats
}

export function encodeCapture(capture: Capture): Omit<UploadBody, "client_id" | "sign_id" | "capture_version" | "meta"> {
  const n = capture.frameCount;
  const labels = new Uint8Array(n * 2);
  const scores = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    labels[i * 2] = capture.hands[LEFT].labels[i];
    labels[i * 2 + 1] = capture.hands[RIGHT].labels[i];
    scores[i * 2] = capture.hands[LEFT].scores[i];
    scores[i * 2 + 1] = capture.hands[RIGHT].scores[i];
  }
  return {
    frame_count: n,
    timestamps_ms: floatsToBase64(capture.timestamps),
    pose: floatsToBase64(capture.pose),
    pose_world: floatsToBase64(capture.poseWorld),
    pose_mask: bytesToBase64(capture.poseMask),
    left_hand: floatsToBase64(capture.hands[LEFT].image),
    left_hand_world: floatsToBase64(capture.hands[LEFT].world),
    left_mask: bytesToBase64(capture.hands[LEFT].mask),
    right_hand: floatsToBase64(capture.hands[RIGHT].image),
    right_hand_world: floatsToBase64(capture.hands[RIGHT].world),
    right_mask: bytesToBase64(capture.hands[RIGHT].mask),
    hand_labels: bytesToBase64(labels),
    hand_scores: floatsToBase64(scores),
  };
}

/** Error in the upload format. `code` goes to the client. */
export class CaptureError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function floats(text: unknown, length: number, name: string): Float32Array {
  if (typeof text !== "string") throw new CaptureError(`invalid_${name}`);
  let values: Float32Array;
  try {
    values = base64ToFloats(text);
  } catch {
    throw new CaptureError(`invalid_${name}`);
  }
  if (values.length !== length) throw new CaptureError(`invalid_${name}_shape`);
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) throw new CaptureError(`invalid_${name}_values`);
  }
  return values;
}

function bytes(text: unknown, length: number, name: string, max: number): Uint8Array {
  if (typeof text !== "string") throw new CaptureError(`invalid_${name}`);
  let values: Uint8Array;
  try {
    values = base64ToBytes(text);
  } catch {
    throw new CaptureError(`invalid_${name}`);
  }
  if (values.length !== length) throw new CaptureError(`invalid_${name}_shape`);
  if (values.some((v) => v > max)) throw new CaptureError(`invalid_${name}_values`);
  return values;
}

/** Zero the data of frames that have mask 0, so the stored file is consistent. */
function clearMasked(values: Float32Array, mask: Uint8Array, perFrame: number): void {
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) values.fill(0, i * perFrame, (i + 1) * perFrame);
  }
}

/** Validate an upload body and return the capture. Throws CaptureError. */
export function decodeCapture(body: Partial<UploadBody>): Capture {
  const n = body.frame_count;
  if (typeof n !== "number" || !Number.isInteger(n) || n < MIN_FRAMES || n > MAX_FRAMES) {
    throw new CaptureError("invalid_frame_count");
  }
  const timestamps = floats(body.timestamps_ms, n, "timestamps");
  if (timestamps[0] !== 0) throw new CaptureError("invalid_timestamps_values");
  for (let i = 1; i < n; i += 1) {
    if (timestamps[i] <= timestamps[i - 1]) throw new CaptureError("invalid_timestamps_values");
  }
  if (timestamps[n - 1] > MAX_DURATION_MS) throw new CaptureError("invalid_timestamps_values");

  const handSize = n * HAND_POINTS * HAND_DIMS;
  const labels = bytes(body.hand_labels, n * 2, "hand_labels", LABEL_RIGHT);
  const scores = floats(body.hand_scores, n * 2, "hand_scores");
  const hand = (side: "left" | "right", index: number): HandChannel => {
    const channel: HandChannel = {
      image: floats(body[`${side}_hand`], handSize, `${side}_hand`),
      world: floats(body[`${side}_hand_world`], handSize, `${side}_hand_world`),
      mask: bytes(body[`${side}_mask`], n, `${side}_mask`, 1),
      labels: new Uint8Array(n),
      scores: new Float32Array(n),
    };
    for (let i = 0; i < n; i += 1) {
      if (!channel.mask[i]) continue;
      channel.labels[i] = labels[i * 2 + index];
      channel.scores[i] = scores[i * 2 + index];
    }
    clearMasked(channel.image, channel.mask, HAND_POINTS * HAND_DIMS);
    clearMasked(channel.world, channel.mask, HAND_POINTS * HAND_DIMS);
    return channel;
  };

  const capture: Capture = {
    frameCount: n,
    timestamps,
    pose: floats(body.pose, n * POSE_POINTS * POSE_DIMS, "pose"),
    poseWorld: floats(body.pose_world, n * POSE_POINTS * WORLD_DIMS, "pose_world"),
    poseMask: bytes(body.pose_mask, n, "pose_mask", 1),
    hands: [hand("left", LEFT), hand("right", RIGHT)],
  };
  clearMasked(capture.pose, capture.poseMask, POSE_POINTS * POSE_DIMS);
  clearMasked(capture.poseWorld, capture.poseMask, POSE_POINTS * WORLD_DIMS);
  return capture;
}
