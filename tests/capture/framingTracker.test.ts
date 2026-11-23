import { describe, expect, test } from "vitest";
import { FramingTracker } from "../../src/capture/framingTracker";

/** Feed a frame every 33 ms with the same state, from `from` to `to`, and give the changes. */
function feed(tracker: FramingTracker, missing: "shoulders" | "arms" | null, from: number, to: number) {
  const changes = [];
  for (let t = from; t <= to; t += 33) {
    const change = tracker.update(missing, t);
    if (change) changes.push(change.state);
  }
  return changes;
}

describe("FramingTracker", () => {
  test("the person is ok after a short time in the picture", () => {
    const tracker = new FramingTracker();
    expect(tracker.update(null, 0)).toBeNull();
    expect(feed(tracker, null, 33, 300)).toEqual(["ok"]);
    expect(tracker.state.state).toBe("ok");
  });

  test("a short loss does not change the state", () => {
    const tracker = new FramingTracker();
    feed(tracker, null, 0, 300);
    expect(feed(tracker, "shoulders", 333, 700)).toEqual([]);
    expect(feed(tracker, null, 733, 1000)).toEqual([]);
    expect(tracker.state.state).toBe("ok");
  });

  test("a long loss makes the state bad, and tells what is missing", () => {
    const tracker = new FramingTracker();
    feed(tracker, null, 0, 300);
    expect(feed(tracker, "arms", 333, 1000)).toEqual(["bad"]);
    expect(tracker.state).toEqual({ state: "bad", missing: "arms" });
  });

  test("a change in what is missing is told again", () => {
    const tracker = new FramingTracker();
    feed(tracker, "arms", 0, 700);
    expect(feed(tracker, "shoulders", 733, 1400)).toEqual(["bad"]);
    expect(tracker.state.missing).toBe("shoulders");
  });

  test("it can go back to ok", () => {
    const tracker = new FramingTracker();
    feed(tracker, "arms", 0, 700);
    expect(feed(tracker, null, 733, 1100)).toEqual(["ok"]);
  });

  test("reset forgets everything", () => {
    const tracker = new FramingTracker();
    feed(tracker, null, 0, 300);
    tracker.reset();
    expect(tracker.state).toEqual({ state: "unknown", missing: null });
  });
});
