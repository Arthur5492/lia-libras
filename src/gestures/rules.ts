import type { GestureFrame, GestureRule, Point } from "./types";

// Indexes of the 21 hand points (MediaPipe).
const WRIST = 0;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;
/** [PIP joint, tip] of the index, middle, ring and pinky fingers. */
const FINGERS: [number, number][] = [[6, 8], [10, 12], [14, 16], [18, 20]];

/** A finger is straight when the tip is farther from the wrist than the middle joint, by this factor. */
const STRAIGHT = 1.15;
/** The wrists can move this much (in hand sizes) during the window and still count as still. */
const STILL_MAX = 0.35;
/** The rule needs this number of frames in the window to judge if the hands are still. */
const MIN_FRAMES = 3;

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Size of a hand in image units: from the wrist to the base of the middle finger. */
export function handSize(hand: Point[]): number {
  return distance(hand[WRIST], hand[MIDDLE_MCP]);
}

/** True if the four fingers and the thumb are straight. */
export function isOpenHand(hand: Point[]): boolean {
  if (hand.length < 21) return false;
  const fingers = FINGERS.every(([pip, tip]) => distance(hand[tip], hand[WRIST]) > distance(hand[pip], hand[WRIST]) * STRAIGHT);
  const thumb = distance(hand[THUMB_TIP], hand[PINKY_MCP]) > distance(hand[THUMB_IP], hand[PINKY_MCP]) * STRAIGHT;
  return fingers && thumb;
}

/** The two hands of a frame, from left to right in the image. Null if the frame does not have exactly two hands. */
function twoHands(frame: GestureFrame): Point[][] | null {
  if (frame.hands.length !== 2) return null;
  return [...frame.hands].sort((a, b) => a[WRIST].x - b[WRIST].x);
}

/** Both hands open and still: the person holds the two open hands in front of the camera. */
export const BOTH_HANDS_OPEN: GestureRule = {
  id: "both_hands_open",
  holdMs: 1000,
  windowMs: 300,
  graceMs: 250,
  test(recent) {
    if (recent.length < MIN_FRAMES) return false;
    const pairs = recent.map(twoHands);
    if (pairs.some((pair) => pair === null)) return false;
    const now = pairs[pairs.length - 1]!;
    if (!now.every(isOpenHand)) return false;
    // Each wrist stays close to its average place in the window.
    return [0, 1].every((side) => {
      const wrists = pairs.map((pair) => pair![side][WRIST]);
      const mean = { x: 0, y: 0, z: 0 };
      for (const w of wrists) {
        mean.x += w.x / wrists.length;
        mean.y += w.y / wrists.length;
      }
      const spread = Math.max(...wrists.map((w) => distance(w, mean)));
      return spread <= handSize(now[side]) * STILL_MAX;
    });
  },
};
