import { describe, expect, test } from "vitest";
import type { RawFrame } from "../../src/capture/pack";
import { Recognizer, type RecognizerOptions } from "../../src/recognize/recognizer";

const OPTIONS: RecognizerOptions = { frames: 4, threshold: 0.9, stability: 3, inferEvery: 1, handLostGrace: 2 };

const withHand = (t: number): RawFrame => ({ t, hands: [{ image: [], world: [], label: "Right", score: 0.9 }] });
const noHand = (t: number): RawFrame => ({ t, hands: [] });

/** A recognizer with a model that gives the answers of `answers`, one for each run. */
function setup(answers: number[][], options = OPTIONS) {
  let run = 0;
  const calls: number[] = [];
  const recognizer = new Recognizer(
    (frames) => frames.map(() => new Float32Array(1)),
    () => {
      calls.push(run);
      return Float32Array.from(answers[Math.min(run++, answers.length - 1)]);
    },
    options,
  );
  return { recognizer, calls };
}

/** Push `count` frames with a hand, and give the signs that were confirmed. */
function feed(recognizer: Recognizer, count: number, start = 0): (number | null)[] {
  return Array.from({ length: count }, (_, i) => recognizer.push(withHand(start + i * 33)).word);
}

describe("Recognizer", () => {
  test("the model waits for a full window", () => {
    const { recognizer, calls } = setup([[0.95, 0.05]]);
    feed(recognizer, 3);
    expect(calls).toEqual([]);
    feed(recognizer, 1, 100);
    expect(calls).toHaveLength(1);
  });

  test("a sign counts after the same prediction in a row, once", () => {
    const { recognizer } = setup([[0.95, 0.05]]);
    const words = feed(recognizer, 12);
    expect(words.filter((w) => w !== null)).toEqual([0]);
  });

  test("a prediction below the limit does not count", () => {
    const { recognizer } = setup([[0.6, 0.4]]);
    expect(feed(recognizer, 12).every((w) => w === null)).toBe(true);
  });

  test("a prediction that changes does not count", () => {
    const alternating = Array.from({ length: 20 }, (_, i) => (i % 2 ? [0.05, 0.95] : [0.95, 0.05]));
    const { recognizer } = setup(alternating);
    expect(feed(recognizer, 12).every((w) => w === null)).toBe(true);
  });

  test("another sign counts when the person changes the sign", () => {
    const answers = [...Array(4).fill([0.95, 0.05]), ...Array(6).fill([0.05, 0.95])];
    const { recognizer } = setup(answers);
    expect(feed(recognizer, 14).filter((w) => w !== null)).toEqual([0, 1]);
  });

  test("the model runs on one frame in a few", () => {
    const { recognizer, calls } = setup([[0.95, 0.05]], { ...OPTIONS, inferEvery: 2 });
    feed(recognizer, 8);
    // The window is full at frame 4. The frames 4, 6 and 8 run the model, so 3 runs.
    expect(calls).toHaveLength(3);
  });

  test("a short loss of the hands does not stop the detection", () => {
    const { recognizer } = setup([[0.95, 0.05]]);
    feed(recognizer, 6);
    expect(recognizer.push(noHand(300)).state).toBe("detecting");
    expect(recognizer.push(noHand(333)).state).toBe("detecting");
  });

  test("a long loss of the hands starts again, and the same sign can come again", () => {
    const { recognizer } = setup([[0.95, 0.05]]);
    const first = feed(recognizer, 8).filter((w) => w !== null);
    expect(first).toEqual([0]);
    for (let i = 0; i < 4; i += 1) recognizer.push(noHand(400 + i * 33));
    expect(recognizer.push(noHand(600)).state).toBe("idle");
    expect(feed(recognizer, 10, 700).filter((w) => w !== null)).toEqual([0]);
  });

  test("without a hand, nothing runs", () => {
    const { recognizer, calls } = setup([[0.95, 0.05]]);
    for (let i = 0; i < 10; i += 1) expect(recognizer.push(noHand(i * 33))).toEqual({ state: "idle", progress: 0, word: null });
    expect(calls).toEqual([]);
  });

  test("the progress goes from 0 to 1 while the sign is recognized", () => {
    const { recognizer } = setup([[0.95, 0.05]]);
    const progress = Array.from({ length: 8 }, (_, i) => recognizer.push(withHand(i * 33)).progress);
    expect(progress[0]).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  test("the numbers can change while it runs", () => {
    const { recognizer } = setup([[0.95, 0.05]], { ...OPTIONS, stability: 6 });
    // With 6 equal predictions needed, a sign is not confirmed in the first 8 frames.
    expect(feed(recognizer, 8).every((w) => w === null)).toBe(true);
    recognizer.reset();
    recognizer.setOptions({ stability: 2 });
    expect(feed(recognizer, 8, 1000).filter((w) => w !== null)).toEqual([0]);
  });

  test("a sign that ends with the hands going down is counted before the same prediction repeats", () => {
    // Needs 3 equal predictions, but the hands go down after the window was full and 2 runs only.
    const { recognizer } = setup([[0.05, 0.95]]);
    expect(feed(recognizer, 5).every((w) => w === null)).toBe(true);
    const words: (number | null)[] = [];
    for (let i = 0; i < 4; i += 1) words.push(recognizer.push(noHand(500 + i * 33)).word);
    expect(words.filter((w) => w !== null)).toEqual([1]);
  });

  test("the last run does not count a sign that was just confirmed, or a weak prediction", () => {
    const confirmed = setup([[0.95, 0.05]]);
    expect(feed(confirmed.recognizer, 8).filter((w) => w !== null)).toEqual([0]);
    for (let i = 0; i < 4; i += 1) expect(confirmed.recognizer.push(noHand(500 + i * 33)).word).toBeNull();

    const weak = setup([[0.6, 0.4]]);
    feed(weak.recognizer, 5);
    for (let i = 0; i < 4; i += 1) expect(weak.recognizer.push(noHand(500 + i * 33)).word).toBeNull();
  });

  test("the last run needs a full window", () => {
    const { recognizer, calls } = setup([[0.95, 0.05]]);
    feed(recognizer, 1);
    for (let i = 0; i < 4; i += 1) recognizer.push(noHand(500 + i * 33));
    expect(calls).toEqual([]);
  });
});
