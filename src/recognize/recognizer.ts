import type { RawFrame } from "../capture/pack";
import type { FeaturesOf } from "./features";

export interface RecognizerOptions {
  frames: number;
  threshold: number;
  stability: number;
  inferEvery: number;
  handLostGrace: number;
}

export interface Step {
  /** `idle` when no hand is in the picture. */
  state: "idle" | "detecting";
  /** From 0 to 1: the window fills first, then the same prediction repeats until it is stable. */
  progress: number;
  /** The index of a sign that the recognizer just confirmed, or null. A sign that is held is confirmed once. */
  word: number | null;
}

/**
 * Follow the frames of the detectors and say when a sign is made. The rules come from the first recognition app:
 * the model reads the last N frames, it runs on one frame in a few, and a sign counts when the same sign comes out
 * a few times in a row with a probability above a limit. When the hands leave the picture for some frames, the
 * model runs one last time on the last window that had a hand, because a sign often ends with the hand going down
 * before the same sign was seen a few times. Then the recognizer starts again, so the same sign can be made twice.
 */
export class Recognizer {
  private window: RawFrame[] = [];
  private predictions: number[] = [];
  private pushed = 0;
  private lost = 0;
  private last = -1;
  /** A copy of the window at the last frame with a hand, when the window was full. */
  private lastFull: RawFrame[] | null = null;

  constructor(
    private featuresOf: FeaturesOf,
    private predict: (features: Float32Array[]) => Float32Array,
    private options: RecognizerOptions,
  ) {}

  /** Change the numbers while the recognizer runs. The number of frames of the window cannot change. */
  setOptions(options: Partial<Omit<RecognizerOptions, "frames">>): void {
    this.options = { ...this.options, ...options };
  }

  reset(): void {
    this.window = [];
    this.predictions = [];
    this.pushed = 0;
    this.lost = 0;
    this.last = -1;
    this.lastFull = null;
  }

  push(frame: RawFrame): Step {
    const { frames, threshold, stability, inferEvery, handLostGrace } = this.options;
    const present = frame.hands.length > 0;
    this.lost = present ? 0 : this.lost + 1;
    // A short loss of the hands, for example at the end of a sign, does not cut the detection.
    if (this.lost > handLostGrace || (!present && this.window.length === 0)) {
      const word = this.finish();
      this.reset();
      return { state: "idle", progress: 0, word };
    }

    this.window.push(frame);
    if (this.window.length > frames) this.window.shift();
    if (present && this.window.length === frames) this.lastFull = [...this.window];
    this.pushed += 1;
    const filling = this.window.length < frames;
    if (filling || this.pushed % inferEvery !== 0) {
      return { state: "detecting", progress: this.progress(filling), word: null };
    }

    const features = this.featuresOf(this.window);
    // A dropped frame (the time did not go up) gives a window of another size, which the model cannot read.
    if (features.length !== frames) return { state: "detecting", progress: this.progress(false), word: null };

    const probabilities = this.predict(features);
    let top = 0;
    probabilities.forEach((value, i) => {
      if (value > probabilities[top]) top = i;
    });
    this.predictions.push(top);
    this.predictions = this.predictions.slice(-stability);
    const stable = this.predictions.length >= stability && this.predictions.every((p) => p === top) && probabilities[top] > threshold;

    let word: number | null = null;
    if (stable && top !== this.last) {
      this.last = top;
      word = top;
    }
    return { state: "detecting", progress: stable ? 1 : this.progress(false), word };
  }

  /**
   * The hands left the picture. Run the model once on the last window that had a hand. The sign counts if the
   * probability is above the limit and it is not the sign that was just confirmed. The window was not full if the
   * hands were in the picture for a short time, and then there is nothing to run.
   */
  private finish(): number | null {
    if (!this.lastFull) return null;
    const features = this.featuresOf(this.lastFull);
    if (features.length !== this.options.frames) return null;
    const probabilities = this.predict(features);
    let top = 0;
    probabilities.forEach((value, i) => {
      if (value > probabilities[top]) top = i;
    });
    return probabilities[top] > this.options.threshold && top !== this.last ? top : null;
  }

  /** The window fills up to one half of the bar, and the repeated predictions fill the other half. */
  private progress(filling: boolean): number {
    if (filling) return (this.window.length / this.options.frames) * 0.5;
    let run = 0;
    for (let i = this.predictions.length - 1; i >= 0 && this.predictions[i] === this.predictions[this.predictions.length - 1]; i -= 1) run += 1;
    return 0.5 + 0.5 * Math.min(1, run / this.options.stability);
  }
}
