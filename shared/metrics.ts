// Quality metrics and validation against reference profiles.
import { HAND_DIMS, HAND_POINTS, LEFT, POSE_DIMS, POSE_POINTS, RIGHT, type Capture, type HandChannel } from "./capture.js";

export const POSE_RATE_MIN = 0.8;
export const ANY_HAND_RATE_MIN = 0.3;
export const DEFAULT_MIN_SIMILARITY_SCORE = 0.7;

export interface Metrics {
  pose_rate: number;
  left_hand_rate: number;
  right_hand_rate: number;
  any_hand_rate: number;
  both_hands_rate: number;
  motion_score: number;
}

export interface ReferenceProfile {
  reference_count: number;
  min_references?: number;
  min_any_hand_rate?: number;
  min_both_hands_rate?: number;
  min_motion_score?: number;
  min_similarity_score?: number;
}

export interface ReferenceProfiles {
  min_references?: number;
  profiles: Record<string, ReferenceProfile>;
}

const HAND_FRAME = HAND_POINTS * HAND_DIMS;

function handCenter(hand: HandChannel, frame: number): [number, number] {
  let x = 0;
  let y = 0;
  for (let j = 0; j < HAND_POINTS; j += 1) {
    x += hand.image[frame * HAND_FRAME + j * HAND_DIMS];
    y += hand.image[frame * HAND_FRAME + j * HAND_DIMS + 1];
  }
  return [x / HAND_POINTS, y / HAND_POINTS];
}

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
/** A shoulder width below this (in image units) is a bad detection. A frame with it does not count for the motion. */
const MIN_SHOULDER_WIDTH = 0.02;

/** The middle of the shoulders and their distance in one frame. Null if the frame has no good pose. */
function shoulders(capture: Capture, frame: number): { origin: [number, number]; width: number } | null {
  if (!capture.poseMask[frame]) return null;
  const at = (point: number) => (frame * POSE_POINTS + point) * POSE_DIMS;
  const lx = capture.pose[at(LEFT_SHOULDER)];
  const ly = capture.pose[at(LEFT_SHOULDER) + 1];
  const rx = capture.pose[at(RIGHT_SHOULDER)];
  const ry = capture.pose[at(RIGHT_SHOULDER) + 1];
  const width = Math.hypot(lx - rx, ly - ry);
  return width < MIN_SHOULDER_WIDTH ? null : { origin: [(lx + rx) / 2, (ly + ry) / 2], width };
}

/**
 * Path length of the center of the visible hands, in shoulder widths. Each center is measured from the middle of
 * the shoulders, so the distance to the camera and the place of the body in the picture do not change the score.
 * A frame without good shoulders does not count.
 */
export function motionScore(capture: Capture): number {
  const [left, right] = capture.hands;
  let total = 0;
  let previous: [number, number] | null = null;
  for (let i = 0; i < capture.frameCount; i += 1) {
    const body = shoulders(capture, i);
    if (!body) continue;
    const centers: [number, number][] = [];
    if (left.mask[i]) centers.push(handCenter(left, i));
    if (right.mask[i]) centers.push(handCenter(right, i));
    if (centers.length === 0) continue;
    const center: [number, number] = [
      (centers.reduce((s, c) => s + c[0], 0) / centers.length - body.origin[0]) / body.width,
      (centers.reduce((s, c) => s + c[1], 0) / centers.length - body.origin[1]) / body.width,
    ];
    if (previous) total += Math.hypot(center[0] - previous[0], center[1] - previous[1]);
    previous = center;
  }
  return total;
}

export function recordingMetrics(capture: Capture): Metrics {
  const n = capture.frameCount;
  const left = capture.hands[LEFT].mask;
  const right = capture.hands[RIGHT].mask;
  let pose = 0;
  let l = 0;
  let r = 0;
  let any = 0;
  let both = 0;
  for (let i = 0; i < n; i += 1) {
    pose += capture.poseMask[i];
    l += left[i];
    r += right[i];
    any += left[i] | right[i];
    both += left[i] & right[i];
  }
  return {
    pose_rate: pose / n,
    left_hand_rate: l / n,
    right_hand_rate: r / n,
    any_hand_rate: any / n,
    both_hands_rate: both / n,
    motion_score: motionScore(capture),
  };
}

/** Failures that stop the save of a recording. */
export function basicFlags(metrics: Metrics): string[] {
  const flags: string[] = [];
  if (metrics.pose_rate < POSE_RATE_MIN) flags.push("low_pose_rate");
  if (metrics.any_hand_rate < ANY_HAND_RATE_MIN) flags.push("low_any_hand_rate");
  return flags;
}

const THRESHOLDS: [keyof ReferenceProfile, keyof Metrics, string][] = [
  ["min_any_hand_rate", "any_hand_rate", "low_any_hand_rate_reference"],
  ["min_both_hands_rate", "both_hands_rate", "low_both_hands_rate_reference"],
  ["min_motion_score", "motion_score", "low_motion_reference"],
];

export interface ReferenceAssessment {
  reference_count: number;
  reference_similarity_score: number | null;
  validation_flags: string[];
}

/** Compare with the profile of the sign. The flags are warnings: they do not stop the save. */
export function assessReference(metrics: Metrics, profiles: ReferenceProfiles, signId: string): ReferenceAssessment {
  const profile = profiles.profiles?.[signId];
  const none = { reference_count: 0, reference_similarity_score: null, validation_flags: [] };
  if (!profile) return none;
  const count = profile.reference_count ?? 0;
  const minimum = profile.min_references ?? profiles.min_references ?? 3;
  if (count < minimum) return { ...none, reference_count: count };

  const ratios: number[] = [];
  const flags: string[] = [];
  for (const [profileKey, metricKey, flag] of THRESHOLDS) {
    const threshold = Number(profile[profileKey] ?? 0);
    if (threshold <= 0) continue;
    const value = metrics[metricKey];
    ratios.push(Math.max(0, Math.min(value / threshold, 1)));
    if (value < threshold) flags.push(flag);
  }
  if (ratios.length === 0) return { reference_count: count, reference_similarity_score: null, validation_flags: flags };
  const score = Math.min(...ratios);
  const minSimilarity = profile.min_similarity_score ?? 0;
  if (minSimilarity > 0 && score < minSimilarity) flags.push("low_reference_similarity");
  return { reference_count: count, reference_similarity_score: score, validation_flags: flags };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const value = sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
  // Round down, so a reference recording never fails its own threshold.
  return Math.floor(Math.max(0, value) * 10000) / 10000;
}

/** Make the thresholds of one sign from the metrics of its reference recordings (10th percentile). */
export function buildProfile(list: Metrics[]): ReferenceProfile {
  return {
    reference_count: list.length,
    min_any_hand_rate: percentile(list.map((m) => m.any_hand_rate), 10),
    min_both_hands_rate: percentile(list.map((m) => m.both_hands_rate), 10),
    min_motion_score: percentile(list.map((m) => m.motion_score), 10),
    min_similarity_score: DEFAULT_MIN_SIMILARITY_SCORE,
  };
}
