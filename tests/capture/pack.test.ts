// Tests for the packing of detector results. The result must pass the server validation.
import { describe, expect, test } from "vitest";
import { decodeCapture, encodeCapture, LEFT, RIGHT } from "../../shared/capture";
import { assignHands } from "../../shared/hands";
import { basicFlags, recordingMetrics } from "../../shared/metrics";
import { packFrames, type Point, type RawFrame, type RawHand } from "../../src/capture/pack";

const points = (x: number, y: number, count: number): Point[] =>
  Array.from({ length: count }, (_, j) => ({ x: x + 0.01 * j, y, z: 0, visibility: 0.9 }));

const hand = (label: string, x: number, y: number): RawHand => ({
  image: points(x, y, 21), world: points(0, 0, 21), label, score: 0.8,
});

function frames(count: number, make: (i: number) => Partial<RawFrame>): RawFrame[] {
  return Array.from({ length: count }, (_, i) => ({ t: 1000 + i * 33.3, hands: [], ...make(i) }));
}

const pose = (rightWristX: number): RawFrame["pose"] => {
  const image = points(0.5, 0.5, 33);
  image[15] = { x: 0.65, y: 0.6, z: 0, visibility: 0.9 };
  image[16] = { x: rightWristX, y: 0.6, z: 0, visibility: 0.9 };
  return { image, world: points(0, 0, 33) };
};

describe("packFrames", () => {
  test("time starts at zero and goes up, and a repeated time is dropped", () => {
    const raw = frames(30, () => ({}));
    raw.splice(10, 0, { ...raw[9] });
    const capture = packFrames(raw);
    expect(capture.frameCount).toBe(30);
    expect(capture.timestamps[0]).toBe(0);
    expect(capture.timestamps[1]).toBeCloseTo(33.3, 1);
  });

  test("a frame without detections has mask zero", () => {
    const capture = packFrames(frames(20, (i) => (i === 3 ? {} : { pose: pose(0.35), hands: [hand("Right", 0.35, 0.6)] })));
    expect(capture.poseMask[3]).toBe(0);
    expect(capture.hands[RIGHT].mask[3]).toBe(0);
    expect(capture.hands[RIGHT].mask[4]).toBe(1);
  });

  test("two hands with the same label keep both", () => {
    const capture = packFrames(
      frames(20, () => ({ pose: pose(0.35), hands: [hand("Right", 0.35, 0.6), hand("Right", 0.65, 0.6)] })),
    );
    expect(capture.hands[RIGHT].mask[0]).toBe(1);
    expect(capture.hands[LEFT].mask[0]).toBe(1);
  });

  test("the frame count has a maximum", () => {
    expect(packFrames(frames(400, () => ({}))).frameCount).toBe(150);
  });

  test("the result passes the server validation and the metrics", () => {
    const raw = frames(45, (i) => ({
      pose: pose(0.35 + 0.004 * i),
      // The detector gives the wrong label: the right hand comes as "Left".
      hands: [hand("Left", 0.35 + 0.004 * i, 0.6)],
    }));
    const decoded = decodeCapture({
      ...encodeCapture(packFrames(raw)),
    });
    const assigned = assignHands(decoded);
    expect(assigned.hands[RIGHT].mask.every((v) => v === 1)).toBe(true);
    expect(assigned.hands[LEFT].mask.some((v) => v === 1)).toBe(false);
    expect(basicFlags(recordingMetrics(assigned))).toEqual([]);
  });
});
