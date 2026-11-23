import { describe, expect, test } from "vitest";
import { GestureEngine } from "../../src/gestures/engine";
import { BOTH_HANDS_OPEN, isOpenHand, SWIPE } from "../../src/gestures/rules";
import type { GestureFrame, Point } from "../../src/gestures/types";

/**
 * A fake hand of 21 points. The wrist is at (cx, cy) and `s` is the size of the hand.
 * An open hand has straight fingers that are apart. A closed hand has the tips near the wrist.
 */
function hand(open: boolean, cx: number, cy: number, s = 0.1, options: { thumbIn?: boolean; together?: boolean } = {}): Point[] {
  const points: Point[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  const put = (i: number, dx: number, dy: number) => (points[i] = { x: cx + dx * s, y: cy + dy * s, z: 0 });
  const apart = options.together ? 1 : 2.2;
  [-0.3, -0.1, 0.1, 0.3].forEach((dx, k) => {
    const base = 5 + 4 * k; // MCP, PIP, DIP, tip
    put(base, dx, -0.6);
    put(base + 1, dx, open ? -0.9 : -0.7);
    put(base + 2, dx, open ? -1.1 : -0.55);
    put(base + 3, open ? dx * apart : dx, open ? -1.3 : -0.4);
  });
  put(1, -0.4, -0.1);
  put(2, -0.6, -0.3);
  put(3, -0.8, -0.5);
  const thumbOut = open && !options.thumbIn;
  put(4, thumbOut ? -1.1 : -0.2, thumbOut ? -0.7 : -0.5);
  return points;
}

const frame = (t: number, hands: Point[][]): GestureFrame => ({ t, hands });
const openPair = (t: number, shift = 0) => frame(t, [hand(true, 0.3 + shift, 0.5), hand(true, 0.7 - shift, 0.5)]);

describe("isOpenHand", () => {
  test("an open hand is open and a fist is not", () => {
    expect(isOpenHand(hand(true, 0.5, 0.5))).toBe(true);
    expect(isOpenHand(hand(false, 0.5, 0.5))).toBe(false);
  });

  test("fingers that are together are not open", () => {
    expect(isOpenHand(hand(true, 0.5, 0.5, 0.1, { together: true }))).toBe(false);
  });

  test("a thumb that is in is not open", () => {
    expect(isOpenHand(hand(true, 0.5, 0.5, 0.1, { thumbIn: true }))).toBe(false);
  });

  test("a hand that is too small to judge is not open", () => {
    expect(isOpenHand(hand(true, 0.5, 0.5, 0.01))).toBe(false);
  });
});

describe("BOTH_HANDS_OPEN", () => {
  const run = (...frames: GestureFrame[]) => BOTH_HANDS_OPEN.test(frames);

  test("two open hands", () => {
    expect(run(openPair(0))).toBe(true);
  });

  test("the hands do not need to be still", () => {
    expect(run(openPair(0), openPair(80, 0.1))).toBe(true);
  });

  test("one hand is not enough", () => {
    expect(run(frame(0, [hand(true, 0.3, 0.5)]))).toBe(false);
  });

  test("a closed hand is not the gesture", () => {
    expect(run(frame(0, [hand(true, 0.3, 0.5), hand(false, 0.7, 0.5)]))).toBe(false);
  });

  test("no frame is not the gesture", () => {
    expect(run()).toBe(false);
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
  const empty = (t: number) => frame(t, []);

  test("triggers once after the hold time", () => {
    const { engine, triggers, progress } = setup();
    feed(engine, 0, 3000);
    expect(triggers).toEqual(["both_hands_open"]);
    expect(Math.max(...progress)).toBe(1);
    expect(progress.some((p) => p > 0 && p < 1)).toBe(true);
  });

  test("it does not trigger before the hold time", () => {
    const { engine, triggers } = setup();
    feed(engine, 0, 480);
    expect(triggers).toEqual([]);
  });

  test("progress goes back to zero when the person stops", () => {
    const { engine, progress, triggers } = setup();
    feed(engine, 0, 320);
    feed(engine, 400, 1200, empty);
    expect(triggers).toEqual([]);
    expect(progress[progress.length - 1]).toBe(0);
  });

  test("a short loss of the hands does not lose the progress", () => {
    const { engine, triggers } = setup();
    feed(engine, 0, 320);
    engine.push(empty(400));
    feed(engine, 480, 1500);
    expect(triggers).toEqual(["both_hands_open"]);
  });

  test("it can trigger again after the person stops", () => {
    const { engine, triggers } = setup();
    feed(engine, 0, 1000);
    feed(engine, 1080, 1800, empty);
    feed(engine, 1880, 3200);
    expect(triggers).toEqual(["both_hands_open", "both_hands_open"]);
  });

  test("reset forgets the progress", () => {
    const { engine, triggers } = setup();
    feed(engine, 0, 320);
    engine.reset();
    feed(engine, 400, 800);
    expect(triggers).toEqual([]);
  });
});

describe("SWIPE", () => {
  const at = (t: number, x: number, y = 0.5, label = "Right") => ({ t, hands: [hand(true, x, y)], labels: [label] });
  const run = (...frames: GestureFrame[]) => SWIPE.test(frames);

  test("a hand that crosses the picture is a swipe, to the left or to the right", () => {
    expect(run(at(0, 0.8), at(200, 0.6), at(400, 0.4))).toBe(true);
    expect(run(at(0, 0.2), at(200, 0.4), at(400, 0.6))).toBe(true);
  });

  test("a short movement is not a swipe", () => {
    expect(run(at(0, 0.5), at(200, 0.55), at(400, 0.6))).toBe(false);
  });

  test("a movement up or down is not a swipe", () => {
    expect(run(at(0, 0.8, 0.8), at(200, 0.6, 0.55), at(400, 0.4, 0.3))).toBe(false);
  });

  test("two frames that are too close in time do not show a movement", () => {
    expect(run(at(0, 0.8), at(100, 0.4))).toBe(false);
  });

  test("two different hands are not one hand that moves", () => {
    const frames = [at(0, 0.8, 0.5, "Left"), at(200, 0.4, 0.5, "Right")];
    expect(run(...frames)).toBe(false);
  });

  test("the engine triggers at once, with no hold time", () => {
    const triggers: string[] = [];
    const engine = new GestureEngine([SWIPE], { onTrigger: (id) => triggers.push(id) });
    [at(0, 0.8), at(200, 0.6), at(400, 0.4)].forEach((f) => engine.push(f));
    expect(triggers).toEqual(["swipe"]);
  });
});
