// Hand assignment by pose wrist, and active hand. See contract/npz.md.
import { emptyHand, HAND_DIMS, HAND_POINTS, LEFT, POSE_DIMS, RIGHT, type Capture, type HandChannel } from "./capture.js";

const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const HAND_FRAME = HAND_POINTS * HAND_DIMS;

type Point = [number, number];

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Return the channel for each hand. `hands` = [wrist xy, source channel]. */
function chooseChannels(hands: [Point, number][], anchors: (Point | null)[]): number[] {
  if (hands.length === 0) return [];
  const left = anchors[LEFT];
  const right = anchors[RIGHT];
  if (hands.length === 1) {
    const [wrist, source] = hands[0];
    if (!left || !right) return [source];
    return [distance(wrist, left) <= distance(wrist, right) ? LEFT : RIGHT];
  }
  const [[a, aSource], [b, bSource]] = hands;
  if (!left || !right) return aSource !== bSource ? [aSource, bSource] : [LEFT, RIGHT];
  const direct = distance(a, left) + distance(b, right);
  const crossed = distance(a, right) + distance(b, left);
  return direct <= crossed ? [LEFT, RIGHT] : [RIGHT, LEFT];
}

function copyFrame(from: HandChannel, to: HandChannel, i: number): void {
  to.image.set(from.image.subarray(i * HAND_FRAME, (i + 1) * HAND_FRAME), i * HAND_FRAME);
  to.world.set(from.world.subarray(i * HAND_FRAME, (i + 1) * HAND_FRAME), i * HAND_FRAME);
  to.mask[i] = 1;
  to.labels[i] = from.labels[i];
  to.scores[i] = from.scores[i];
}

/**
 * Put each hand in the channel of the nearest pose wrist.
 * The function is idempotent: a second run gives the same result.
 */
export function assignHands(capture: Capture): Capture {
  const n = capture.frameCount;
  const out: [HandChannel, HandChannel] = [emptyHand(n), emptyHand(n)];
  const last: (Point | null)[] = [null, null];

  for (let i = 0; i < n; i += 1) {
    const hands: [Point, number][] = [];
    for (const channel of [LEFT, RIGHT]) {
      const hand = capture.hands[channel];
      if (hand.mask[i]) hands.push([[hand.image[i * HAND_FRAME], hand.image[i * HAND_FRAME + 1]], channel]);
    }
    let anchors: (Point | null)[] = last;
    if (capture.poseMask[i]) {
      const base = i * 33 * POSE_DIMS;
      anchors = [
        [capture.pose[base + LEFT_WRIST * POSE_DIMS], capture.pose[base + LEFT_WRIST * POSE_DIMS + 1]],
        [capture.pose[base + RIGHT_WRIST * POSE_DIMS], capture.pose[base + RIGHT_WRIST * POSE_DIMS + 1]],
      ];
    }
    const channels = chooseChannels(hands, anchors);
    hands.forEach(([wrist, source], index) => {
      copyFrame(capture.hands[source], out[channels[index]], i);
      last[channels[index]] = wrist;
    });
  }
  return { ...capture, hands: out };
}

function wristMotion(hand: HandChannel): number {
  let total = 0;
  let previous: Point | null = null;
  for (let i = 0; i < hand.mask.length; i += 1) {
    if (!hand.mask[i]) continue;
    const point: Point = [hand.image[i * HAND_FRAME], hand.image[i * HAND_FRAME + 1]];
    if (previous) total += distance(point, previous);
    previous = point;
  }
  return total;
}

function count(mask: Uint8Array): number {
  return mask.reduce((sum, value) => sum + value, 0);
}

/** Return `left`, `right` or `unknown`. Use as extra data only: it is not reliable for static signs. */
export function activeHand(capture: Capture): "left" | "right" | "unknown" {
  const [left, right] = capture.hands;
  const leftCount = count(left.mask);
  const rightCount = count(right.mask);
  if (leftCount === 0 && rightCount === 0) return "unknown";
  if (Math.min(leftCount, rightCount) >= capture.frameCount * 0.5) {
    return wristMotion(left) >= wristMotion(right) ? "left" : "right";
  }
  return leftCount >= rightCount ? "left" : "right";
}
