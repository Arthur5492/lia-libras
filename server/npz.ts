// Write and read `.npz` files (a zip of NumPy `.npy` arrays). See contract/npz.md.
import { unzipSync, zipSync } from "fflate";
import {
  emptyHand, HAND_DIMS, HAND_POINTS, LEFT, POSE_DIMS, POSE_POINTS, RIGHT, SCHEMA_VERSION, WORLD_DIMS,
  type Capture,
} from "../shared/capture.js";

type Typed = Float32Array | Uint8Array;

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0];

/** One array in NumPy format, version 1.0. */
function npy(data: Typed, shape: number[]): Uint8Array {
  const descr = data instanceof Float32Array ? "<f4" : "|u1";
  const dims = shape.length === 1 ? `${shape[0]},` : shape.join(", ");
  let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': (${dims}), }`;
  // The total length of magic, length field and header must be a multiple of 64.
  const padding = 64 - ((MAGIC.length + 2 + header.length + 1) % 64);
  header += " ".repeat(padding % 64) + "\n";
  const bytes = new Uint8Array(MAGIC.length + 2 + header.length + data.byteLength);
  bytes.set(MAGIC);
  bytes[8] = header.length & 0xff;
  bytes[9] = header.length >> 8;
  for (let i = 0; i < header.length; i += 1) bytes[10 + i] = header.charCodeAt(i);
  bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), 10 + header.length);
  return bytes;
}

function parseNpy(bytes: Uint8Array): { data: Typed; shape: number[] } {
  if (bytes[0] !== 0x93 || bytes[6] !== 1) throw new Error("unsupported npy file");
  const headerLength = bytes[8] | (bytes[9] << 8);
  const header = new TextDecoder().decode(bytes.subarray(10, 10 + headerLength));
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const body = bytes.slice(10 + headerLength);
  if (descr === "<f4") return { data: new Float32Array(body.buffer, 0, body.byteLength / 4), shape };
  if (descr === "|u1") return { data: body, shape };
  throw new Error(`unsupported dtype ${descr}`);
}

export interface RecordingMeta {
  schema_version: string;
  capture_version: string;
  sign_id: string;
  video_idx: number;
  frame_count: number;
  duration_ms: number;
  video_width: number;
  video_height: number;
}

export function writeNpz(capture: Capture, meta: Omit<RecordingMeta, "schema_version" | "frame_count">): Uint8Array {
  const n = capture.frameCount;
  const [left, right] = capture.hands;
  const fullMeta: RecordingMeta = { schema_version: SCHEMA_VERSION, frame_count: n, ...meta };
  const labels = new Uint8Array(n * 2);
  const scores = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    labels[i * 2] = left.labels[i];
    labels[i * 2 + 1] = right.labels[i];
    scores[i * 2] = left.scores[i];
    scores[i * 2 + 1] = right.scores[i];
  }
  const metaBytes = new TextEncoder().encode(JSON.stringify(fullMeta));
  const hand = [n, HAND_POINTS, HAND_DIMS];
  return zipSync(
    {
      "meta.npy": npy(metaBytes, [metaBytes.length]),
      "timestamps_ms.npy": npy(capture.timestamps, [n]),
      "pose.npy": npy(capture.pose, [n, POSE_POINTS, POSE_DIMS]),
      "pose_world.npy": npy(capture.poseWorld, [n, POSE_POINTS, WORLD_DIMS]),
      "pose_mask.npy": npy(capture.poseMask, [n]),
      "left_hand.npy": npy(left.image, hand),
      "left_hand_world.npy": npy(left.world, hand),
      "left_mask.npy": npy(left.mask, [n]),
      "right_hand.npy": npy(right.image, hand),
      "right_hand_world.npy": npy(right.world, hand),
      "right_mask.npy": npy(right.mask, [n]),
      "hand_labels.npy": npy(labels, [n, 2]),
      "hand_scores.npy": npy(scores, [n, 2]),
    },
    { level: 6 },
  );
}

export function readNpz(bytes: Uint8Array): { capture: Capture; meta: RecordingMeta } {
  const files = unzipSync(bytes);
  const get = (name: string): Typed => {
    const file = files[`${name}.npy`];
    if (!file) throw new Error(`missing ${name} in npz`);
    return parseNpy(file).data;
  };
  const meta = JSON.parse(new TextDecoder().decode(get("meta") as Uint8Array)) as RecordingMeta;
  const n = meta.frame_count;
  const labels = get("hand_labels") as Uint8Array;
  const scores = get("hand_scores") as Float32Array;
  const hand = (side: "left" | "right", index: number) => {
    const channel = emptyHand(n);
    channel.image = get(`${side}_hand`) as Float32Array;
    channel.world = get(`${side}_hand_world`) as Float32Array;
    channel.mask = get(`${side}_mask`) as Uint8Array;
    for (let i = 0; i < n; i += 1) {
      channel.labels[i] = labels[i * 2 + index];
      channel.scores[i] = scores[i * 2 + index];
    }
    return channel;
  };
  return {
    meta,
    capture: {
      frameCount: n,
      timestamps: get("timestamps_ms") as Float32Array,
      pose: get("pose") as Float32Array,
      poseWorld: get("pose_world") as Float32Array,
      poseMask: get("pose_mask") as Uint8Array,
      hands: [hand("left", LEFT), hand("right", RIGHT)],
    },
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Landmarks in the format that the browser replay draws: pose [x, y, visibility], hands [x, y]. */
export function replayPayload(capture: Capture) {
  const n = capture.frameCount;
  const pick = (data: Float32Array, points: number, dims: number, columns: number[]) =>
    Array.from({ length: n }, (_, i) =>
      Array.from({ length: points }, (_, j) => columns.map((c) => round4(data[(i * points + j) * dims + c]))),
    );
  return {
    frame_count: n,
    timestamps_ms: Array.from(capture.timestamps, (t) => Math.round(t)),
    pose: pick(capture.pose, POSE_POINTS, POSE_DIMS, [0, 1, 3]),
    pose_mask: Array.from(capture.poseMask),
    left_hand: pick(capture.hands[LEFT].image, HAND_POINTS, HAND_DIMS, [0, 1]),
    left_mask: Array.from(capture.hands[LEFT].mask),
    right_hand: pick(capture.hands[RIGHT].image, HAND_POINTS, HAND_DIMS, [0, 1]),
    right_mask: Array.from(capture.hands[RIGHT].mask),
  };
}
