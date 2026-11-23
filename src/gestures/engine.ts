import type { GestureEvents, GestureFrame, GestureRule } from "./types";

/**
 * Follow some gesture rules over the video frames. Call `push` for each frame.
 * Each gesture triggers once. It can trigger again only after the person stops it.
 */
export class GestureEngine {
  private frames: GestureFrame[] = [];
  private since = new Map<string, number>();
  private lastTrue = new Map<string, number>();
  private fired = new Set<string>();
  private shown = new Map<string, number>();

  constructor(private rules: GestureRule[], private events: GestureEvents = {}) {}

  push(frame: GestureFrame): void {
    const longest = Math.max(0, ...this.rules.map((rule) => rule.windowMs));
    this.frames.push(frame);
    while (this.frames.length > 1 && this.frames[0].t < frame.t - longest) this.frames.shift();

    for (const rule of this.rules) {
      const recent = this.frames.filter((f) => f.t >= frame.t - rule.windowMs);
      if (rule.test(recent)) {
        this.lastTrue.set(rule.id, frame.t);
        this.advance(rule, frame.t);
      } else if (frame.t - (this.lastTrue.get(rule.id) ?? -Infinity) > (rule.graceMs ?? 0)) {
        this.stop(rule.id);
      }
    }
  }

  /** Forget all frames and progress, for example when a recording starts. */
  reset(): void {
    this.frames = [];
    for (const rule of this.rules) this.stop(rule.id);
    this.fired.clear();
    this.lastTrue.clear();
  }

  private advance(rule: GestureRule, t: number): void {
    if (this.fired.has(rule.id)) return;
    if (!this.since.has(rule.id)) this.since.set(rule.id, t);
    const progress = Math.min(1, (t - this.since.get(rule.id)!) / rule.holdMs);
    this.show(rule.id, progress);
    if (progress >= 1) {
      this.fired.add(rule.id);
      this.events.onTrigger?.(rule.id);
    }
  }

  private stop(id: string): void {
    this.since.delete(id);
    this.fired.delete(id);
    this.show(id, 0);
  }

  private show(id: string, progress: number): void {
    if (this.shown.get(id) === progress) return;
    this.shown.set(id, progress);
    this.events.onProgress?.(id, progress);
  }
}
