import type { Missing } from "../../shared/framing";

/** The person is in the picture for this long (milliseconds) before the state becomes `ok`. */
const GOOD_MS = 200;
/**
 * The detector loses a point easily. The person must be out of the picture for this long before the state becomes
 * `bad`, so one bad frame does not stop anybody.
 */
const BAD_MS = 500;

export interface Framing {
  state: "unknown" | "ok" | "bad";
  missing: Missing | null;
}

/** Follow the framing of the person over the frames, with a delay in both directions so that it does not flicker. */
export class FramingTracker {
  state: Framing = { state: "unknown", missing: null };
  private goodSince: number | null = null;
  private badSince: number | null = null;

  /** Give what is missing in a frame (null if nothing) and the time of the frame. It returns the new state if it changed. */
  update(missing: Missing | null, t: number): Framing | null {
    if (missing === null) {
      this.goodSince ??= t;
      this.badSince = null;
    } else {
      this.badSince ??= t;
      this.goodSince = null;
    }
    let next: Framing | null = null;
    if (missing === null && this.state.state !== "ok" && t - this.goodSince! >= GOOD_MS) {
      next = { state: "ok", missing: null };
    } else if (missing !== null && t - this.badSince! >= BAD_MS && (this.state.state !== "bad" || this.state.missing !== missing)) {
      next = { state: "bad", missing };
    }
    if (next) this.state = next;
    return next;
  }

  reset(): void {
    this.state = { state: "unknown", missing: null };
    this.goodSince = null;
    this.badSince = null;
  }
}
