import { describe, expect, test } from "vitest";
import { GestureEngine } from "../../src/gestures/engine";
import { BOTH_HANDS_OPEN, isOpenHand } from "../../src/gestures/rules";
import type { GestureFrame, Point } from "../../src/gestures/types";

/** A fake hand of 21 points. The wrist is at (cx, cy) and `s` is the size of the hand. */
function hand(open: boolean, cx: number, cy: number, s = 0.1): Point[] {
  const points: Point[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  const put = (i: number, dx: number, dy: number) => (points[i] = { x: cx + dx * s, y: cy + dy * s, z: 0 });
  [-0.3, -0.1, 0.1, 0.3].forEach((dx, k) => {
    const base = 5 + 4 * k; // MCP, PIP, DIP, tip
    put(base, dx, -0.6);
    put(base + 1, dx, open ? -0.9 : -0.7);
    put(base + 2, dx, open ? -1.1 : -0.55);
    put(base + 3, dx, open ? -1.3 : -0.4);
  });
  put(1, -0.4, -0.1);
  put(2, -0.6, -0.3);
  put(3, -0.8, -0.5);
  put(4, open ? -1.1 : -0.2, open ? -0.7 : -0.5);
  return points;
}

const frame = (t: number, hands: Point[][]): GestureFrame => ({ t, hands });
const openPair = (t: number, shift = 0) => frame(t, [hand(true, 0.3 + shift, 0.5), hand(true, 0.7 - shift, 0.5)]);

describe("isOpenHand", () => {
  test("an open hand is open and a fist is not", () => {
    expect(isOpenHand(hand(true, 0.5, 0.5))).toBe(true);
    expect(isOpenHand(hand(false, 0.5, 0.5))).toBe(false);
  });
});

describe("BOTH_HANDS_OPEN", () => {
  const run = (frames: GestureFrame[]) => BOTH_HANDS_OPEN.test(frames);

  test("two open hands that stay still", () => {
    expect(run([openPair(0), openPair(80), openPair(160), openPair(240)])).toBe(true);
  });

  test("it needs a few frames to judge that the hands are still", () => {
    expect(run([openPair(0), openPair(80)])).toBe(false);
  });

  test("one hand or three hands is not the gesture", () => {
    const one = frame(0, [hand(true, 0.3, 0.5)]);
    expect(run([one, { ...one, t: 80 }, { ...one, t: 160 }])).toBe(false);
  });

  test("a closed hand is not the gesture", () => {
    const mixed = (t: number) => frame(t, [hand(true, 0.3, 0.5), hand(false, 0.7, 0.5)]);
    expect(run([mixed(0), mixed(80), mixed(160)])).toBe(false);
  });

  test("hands that move a lot are not still", () => {
    expect(run([openPair(0, 0), openPair(80, 0.05), openPair(160, 0.1), openPair(240, 0.15)])).toBe(false);
  });

  test("small tremors are still", () => {
    expect(run([openPair(0, 0), openPair(80, 0.004), openPair(160, -0.004), openPair(240, 0)])).toBe(true);
  });

  test("the hands can be in the other order in the list", () => {
    const swapped = (t: number) => frame(t, [hand(true, 0.7, 0.5), hand(true, 0.3, 0.5)]);
    expect(run([swapped(0), openPair(80), swapped(160), openPair(240)])).toBe(true);
  });
});

describe("GestureEngine", () => {
  function setup() {
    const progress: number[] = [];
    const triggers: string[] = [];
    const engine = new GestureEngine([BOTH_HANDS_OPEN], {
      onProgress: (_, p) => progress.push(p),
      onTrigger: (id) => triggers.push(id),
    });
    return { engine, progress, triggers };
  }
  const feed = (engine: GestureEngine, from: number, to: number, make = openPair) => {
    for (let t = from; t <= to; t += 80) engine.push(make(t));
  };

  test("triggers once after the hold time", () => {
    const { engine, triggers, progress } = setup();
    feed(engine, 0, 3000);
    expect(triggers).toEqual(["both_hands_open"]);
    expect(Math.max(...progress)).toBe(1);
    expect(progress.some((p) => p > 0 && p < 1)).toBe(true);
  });

  test("it does not trigger before the hold time", () => {
    const { engine, triggers } = setup();
    feed(engine, 0, 900);
    expect(triggers).toEqual([]);
  });

  test("progress goes back to zero when the person stops", () => {
    const { engine, progress, triggers } = setup();
    feed(engine, 0, 560);
    feed(engine, 640, 1400, (t) => frame(t, []));
    expect(triggers).toEqual([]);
    expect(progress[progress.length - 1]).toBe(0);
  });

  test("a short loss of the hands does not lose the progress", () => {
    const { engine, triggers } = setup();
    feed(engine, 0, 560);
    engine.push(frame(640, []));
    feed(engine, 720, 2000);
    expect(triggers).toEqual(["both_hands_open"]);
  });

  test("it can trigger again after the person stops", () => {
    const { engine, triggers } = setup();
    feed(engine, 0, 2000);
    feed(engine, 2080, 2800, (t) => frame(t, []));
    feed(engine, 2880, 5000);
    expect(triggers).toEqual(["both_hands_open", "both_hands_open"]);
  });

  test("reset forgets the progress", () => {
    const { engine, triggers } = setup();
    feed(engine, 0, 560);
    engine.reset();
    feed(engine, 640, 1200);
    expect(triggers).toEqual([]);
  });
});
