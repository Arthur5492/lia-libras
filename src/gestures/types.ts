// Types for the gesture module. A gesture is a rule that the person must keep true for some time.

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** One video frame, as the rules see it. Coordinates are image units (0 to 1). One array of 21 points for each hand. */
export interface GestureFrame {
  /** Time in milliseconds. It always goes up. */
  t: number;
  hands: Point[][];
  /** The label of each hand ("Left" or "Right"), in the same order. It tells a hand from the other between frames. */
  labels?: string[];
}

export interface GestureRule {
  id: string;
  /** Time that the rule must stay true before the gesture counts, in milliseconds. */
  holdMs: number;
  /** Time of the recent frames that `test` receives, in milliseconds. */
  windowMs: number;
  /** Time that the rule can be false without the person losing the progress. It hides a frame with a bad detection. */
  graceMs?: number;
  /** True if the person shows the gesture now. `recent` ends with the current frame. */
  test(recent: GestureFrame[]): boolean;
}

export interface GestureEvents {
  /** Progress from 0 to 1. It is 0 when the person stops. */
  onProgress?(id: string, progress: number): void;
  /** The person kept the gesture for the full time. */
  onTrigger?(id: string): void;
}
