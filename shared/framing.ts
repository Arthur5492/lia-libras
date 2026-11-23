// Check that the person is in the picture: both shoulders and at least one arm, from the elbow to the wrist.
// The device checks the frames while the person waits, and the recording after it. The server checks it again.
// The first collection app also asked for the face, the two arms and 70% of the frames. That was too strict:
// the detector loses a point easily, and the face is often behind a hand during a sign.
import { POSE_DIMS, POSE_POINTS, type Capture } from "./capture.js";
import { basicFlags, type Metrics } from "./metrics.js";

/** A point of the pose is visible when its confidence is at least this. */
export const VISIBILITY_MIN = 0.5;
/** A recording is good when the person is in the picture in at least this part of the frames. */
export const COVERAGE_MIN = 0.6;

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
/** [elbow, wrist] of the left arm and of the right arm. */
const ARMS: [number, number][] = [[13, 15], [14, 16]];

export type Missing = "shoulders" | "arms";

interface PosePoint {
  x: number;
  y: number;
  visibility?: number;
}

function isVisible(point: PosePoint | undefined): boolean {
  return (
    point !== undefined &&
    (point.visibility ?? 1) >= VISIBILITY_MIN &&
    point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
  );
}

/** What is missing in one frame, or null if the person is in the picture. `pose` has the 33 points, or is undefined. */
export function missingInFrame(pose: PosePoint[] | undefined): Missing | null {
  if (!pose) return "shoulders";
  if (!isVisible(pose[LEFT_SHOULDER]) || !isVisible(pose[RIGHT_SHOULDER])) return "shoulders";
  const hasArm = ARMS.some(([elbow, wrist]) => isVisible(pose[elbow]) && isVisible(pose[wrist]));
  return hasArm ? null : "arms";
}

function frameMissing(capture: Capture, frame: number): Missing | null {
  if (!capture.poseMask[frame]) return "shoulders";
  const point = (index: number): PosePoint => {
    const at = (frame * POSE_POINTS + index) * POSE_DIMS;
    return { x: capture.pose[at], y: capture.pose[at + 1], visibility: capture.pose[at + 3] };
  };
  const pose: PosePoint[] = [];
  for (const index of [LEFT_SHOULDER, RIGHT_SHOULDER, ...ARMS.flat()]) pose[index] = point(index);
  return missingInFrame(pose);
}

export interface Coverage {
  /** Part of the frames in which the person is in the picture, from 0 to 1. */
  rate: number;
  /** What was missing most often in the other frames. Null if nothing was missing. */
  missing: Missing | null;
}

export function framingCoverage(capture: Capture): Coverage {
  const counts: Record<Missing, number> = { shoulders: 0, arms: 0 };
  let good = 0;
  for (let i = 0; i < capture.frameCount; i += 1) {
    const missing = frameMissing(capture, i);
    if (missing === null) good += 1;
    else counts[missing] += 1;
  }
  const missing = counts.shoulders === 0 && counts.arms === 0 ? null : counts.shoulders >= counts.arms ? "shoulders" : "arms";
  return { rate: capture.frameCount > 0 ? good / capture.frameCount : 0, missing };
}

/** Flags that stop the save of a recording because the person was not in the picture long enough. */
export function framingFlags(capture: Capture): string[] {
  return framingCoverage(capture).rate < COVERAGE_MIN ? ["low_framing"] : [];
}

/**
 * All the flags that stop the save of a recording: the basic ones, and the framing.
 * The framing is not flagged when the pose rate already is, because the person was not in the picture then too.
 */
export function saveFlags(capture: Capture, metrics: Metrics): string[] {
  const flags = basicFlags(metrics);
  if (!flags.includes("low_pose_rate")) flags.push(...framingFlags(capture));
  return flags;
}
