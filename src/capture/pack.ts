// Pack detector results into the capture format. No browser code here, so tests can run it.
import {
  emptyHand, HAND_DIMS, HAND_POINTS, LABEL_LEFT, LABEL_RIGHT, LEFT, MAX_FRAMES, POSE_DIMS, POSE_POINTS, RIGHT,
  WORLD_DIMS, type Capture, type HandChannel,
} from "../../shared/capture";

export interface Point {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface RawHand {
  image: Point[];
  world: Point[];
  /** "Left" or "Right", from the detector. */
  label: string;
  score: number;
}

/** What the detectors gave for one video frame. */
export interface RawFrame {
  /** Time in milliseconds. */
  t: number;
  pose?: { image: Point[]; world: Point[] };
  hands: RawHand[];
}

const HAND_FRAME = HAND_POINTS * HAND_DIMS;

function writeHand(channel: HandChannel, i: number, hand: RawHand, label: number): void {
  hand.image.slice(0, HAND_POINTS).forEach((p, j) => channel.image.set([p.x, p.y, p.z], i * HAND_FRAME + j * HAND_DIMS));
  hand.world.slice(0, HAND_POINTS).forEach((p, j) => channel.world.set([p.x, p.y, p.z], i * HAND_FRAME + j * HAND_DIMS));
  channel.mask[i] = 1;
  channel.labels[i] = label;
  channel.scores[i] = hand.score;
}

/**
 * Make a capture from the frames. Time goes up from 0. A frame with a time that does not increase is dropped.
 * Each hand goes to the channel of its detector label. If two hands have the same label, the second one
 * goes to the other channel. The server then sets the final channels with the wrist rule.
 */
export function packFrames(frames: RawFrame[]): Capture {
  const ordered: RawFrame[] = [];
  for (const frame of frames) {
    if (ordered.length === 0 || frame.t > ordered[ordered.length - 1].t) ordered.push(frame);
    if (ordered.length === MAX_FRAMES) break;
  }
  const n = ordered.length;
  const start = n > 0 ? ordered[0].t : 0;
  const capture: Capture = {
    frameCount: n,
    timestamps: Float32Array.from(ordered, (f) => f.t - start),
    pose: new Float32Array(n * POSE_POINTS * POSE_DIMS),
    poseWorld: new Float32Array(n * POSE_POINTS * WORLD_DIMS),
    poseMask: new Uint8Array(n),
    hands: [emptyHand(n), emptyHand(n)],
  };

  ordered.forEach((frame, i) => {
    if (frame.pose && frame.pose.image.length >= POSE_POINTS) {
      capture.poseMask[i] = 1;
      frame.pose.image.slice(0, POSE_POINTS).forEach((p, j) =>
        capture.pose.set([p.x, p.y, p.z, p.visibility ?? 0], (i * POSE_POINTS + j) * POSE_DIMS),
      );
      frame.pose.world.slice(0, POSE_POINTS).forEach((p, j) =>
        capture.poseWorld.set([p.x, p.y, p.z], (i * POSE_POINTS + j) * WORLD_DIMS),
      );
    }
    for (const hand of frame.hands.slice(0, 2)) {
      const wanted = hand.label === "Left" ? LEFT : RIGHT;
      const channel = capture.hands[wanted].mask[i] ? 1 - wanted : wanted;
      writeHand(capture.hands[channel], i, hand, hand.label === "Left" ? LABEL_LEFT : LABEL_RIGHT);
    }
  });
  return capture;
}
