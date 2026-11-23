// The 196 features of the first model (feature version "image-v1"). They come from the image landmarks, as in the
// feature code of the first training project. The training folder of this repository uses the world landmarks instead.
import { HAND_DIMS, HAND_POINTS, LEFT, POSE_DIMS, RIGHT, type Capture } from "../../shared/capture";

export const IMAGE_FEATURE_SIZE = 196;
const POSE_INDICES = Array.from({ length: 14 }, (_, i) => 11 + i);
const EPS = 1e-6;
const FINGERS: [number, number, number][] = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];
const TIPS = [8, 12, 16, 20];
const BASES = [5, 9, 13, 17];

type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function flexion(base: Vec, middle: Vec, tip: Vec): number {
  const a = sub(middle, base);
  const b = sub(tip, middle);
  const product = norm(a) * norm(b);
  if (product < EPS) return 0;
  return Math.min(1, Math.max(-1, dot(a, b) / product));
}

function shape(hand: Vec[]): number[] {
  let scale = norm(sub(hand[9], hand[0]));
  if (scale < EPS) scale = 1;
  const thumb = hand[4];
  return [
    ...TIPS.map((t) => norm(sub(thumb, hand[t])) / scale),
    ...BASES.map((b) => norm(sub(thumb, hand[b])) / scale),
    ...FINGERS.map(([b, m, t]) => flexion(hand[b], hand[m], hand[t])),
    flexion(hand[2], hand[3], hand[4]),
    norm(sub(hand[8], hand[20])) / scale,
  ];
}

function handAt(capture: Capture, channel: number, i: number): Vec[] | null {
  const hand = capture.hands[channel];
  if (!hand.mask[i]) return null;
  const size = HAND_POINTS * HAND_DIMS;
  return Array.from({ length: HAND_POINTS }, (_, j) => {
    const at = i * size + j * HAND_DIMS;
    return [hand.image[at], hand.image[at + 1], hand.image[at + 2]] as Vec;
  });
}

function normalizedHand(hand: Vec[] | null): number[] {
  if (!hand) return new Array(HAND_POINTS * 3).fill(0);
  let scale = norm(sub(hand[9], hand[0]));
  if (scale < EPS) scale = 1;
  return hand.flatMap((p) => sub(p, hand[0]).map((v) => v / scale));
}

/** Features of one frame. The hand assignment (wrist rule) must be done before. */
export function frameFeatures(capture: Capture, i: number): Float32Array {
  const out = new Float32Array(IMAGE_FEATURE_SIZE);
  const left = handAt(capture, LEFT, i);
  const right = handAt(capture, RIGHT, i);
  let pose: number[] = new Array(14 * 3).fill(0);
  if (capture.poseMask[i]) {
    const at = (j: number): Vec => {
      const base = (i * 33 + j) * POSE_DIMS;
      return [capture.pose[base], capture.pose[base + 1], capture.pose[base + 2]];
    };
    const l = at(11);
    const r = at(12);
    const center: Vec = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2];
    let width = norm(sub(l, r));
    if (width < EPS) width = 1;
    pose = POSE_INDICES.flatMap((j) => sub(at(j), center).map((v) => v / width));
  }
  out.set([
    ...pose, ...normalizedHand(left), ...normalizedHand(right),
    ...(left ? shape(left) : new Array(14).fill(0)),
    ...(right ? shape(right) : new Array(14).fill(0)),
  ]);
  return out;
}
