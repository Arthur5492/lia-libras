import type { GestureRule, Point } from "./types";

// Indexes of the 21 hand points (MediaPipe).
const WRIST = 0;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;
/** [tip, PIP joint, MCP joint] of the index, middle, ring and pinky fingers. */
const FINGERS: [number, number, number][] = [[8, 6, 5], [12, 10, 9], [16, 14, 13], [20, 18, 17]];
const INDEX_TIP = 8;
const PINKY_TIP = 20;

// Limits from the first collection app, where the gesture was tested with real people.
/** The hand is too small or too far to judge when the palm is narrower than this (image units). */
const MIN_PALM_WIDTH = 0.015;
/** A finger is straight when the tip is farther from the wrist than the middle joint by this factor... */
const FINGER_STRAIGHT = 1.08;
/** ...and the tip is farther from its base than this part of the palm width. */
const FINGER_LENGTH = 0.55;
const THUMB_STRAIGHT = 1.03;
/** The thumb tip is farther from the middle finger base than this part of the palm width. */
const THUMB_AWAY = 0.85;
/** The distance between the index tip and the pinky tip, in palm widths. */
const SPREAD_MIN = 1.35;

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function isFingerStraight(hand: Point[], [tip, pip, mcp]: [number, number, number], palm: number): boolean {
  return (
    distance(hand[tip], hand[WRIST]) > distance(hand[pip], hand[WRIST]) * FINGER_STRAIGHT &&
    distance(hand[tip], hand[mcp]) > palm * FINGER_LENGTH
  );
}

/** True if the four fingers and the thumb are straight and the fingers are apart: an open hand, palm to the camera. */
export function isOpenHand(hand: Point[]): boolean {
  if (hand.length < 21) return false;
  const palm = distance(hand[INDEX_MCP], hand[PINKY_MCP]);
  if (palm <= MIN_PALM_WIDTH) return false;

  const straight = FINGERS.filter((finger) => isFingerStraight(hand, finger, palm)).length;
  const thumbOpen =
    distance(hand[THUMB_TIP], hand[WRIST]) > distance(hand[THUMB_IP], hand[WRIST]) * THUMB_STRAIGHT &&
    distance(hand[THUMB_TIP], hand[MIDDLE_MCP]) > palm * THUMB_AWAY;
  const spread = distance(hand[INDEX_TIP], hand[PINKY_TIP]) / palm;
  return straight >= 4 && thumbOpen && spread >= SPREAD_MIN;
}

/** Both hands open in front of the camera, for a short time. The hands do not need to be still. */
export const BOTH_HANDS_OPEN: GestureRule = {
  id: "both_hands_open",
  holdMs: 600,
  windowMs: 0,
  // One frame with a bad detection must not make the person start again.
  graceMs: 250,
  test(recent) {
    const now = recent[recent.length - 1];
    return now !== undefined && now.hands.filter(isOpenHand).length >= 2;
  },
};
