// Tests for the replay: the frame for a time, and the drawing.
import { describe, expect, test } from "vitest";
import { drawFrame, duration, frameAt, type ReplayData } from "../../src/replay/draw";

describe("frameAt", () => {
  const times = [0, 40, 90, 200];

  test("gives the last frame that is not after the time", () => {
    expect(frameAt(times, 0)).toBe(0);
    expect(frameAt(times, 39.9)).toBe(0);
    expect(frameAt(times, 40)).toBe(1);
    expect(frameAt(times, 150)).toBe(2);
  });

  test("the time after the end and the empty list are safe", () => {
    expect(frameAt(times, 5000)).toBe(3);
    expect(frameAt([], 10)).toBe(0);
    expect(duration(times)).toBe(200);
    expect(duration([])).toBe(0);
  });
});

describe("drawFrame", () => {
  // A small fake of the canvas context. It records the points that the code draws.
  function fakeContext() {
    const calls: string[] = [];
    const ctx = {
      canvas: { width: 100, height: 80 },
      fillStyle: "", strokeStyle: "", lineWidth: 0,
      clearRect: () => calls.push("clear"),
      fillRect: () => calls.push("background"),
      beginPath: () => {},
      moveTo: (x: number, y: number) => calls.push(`move ${x} ${y}`),
      lineTo: (x: number, y: number) => calls.push(`line ${x} ${y}`),
      stroke: () => calls.push("stroke"),
      arc: (x: number, y: number) => calls.push(`dot ${x} ${y}`),
      fill: () => {},
    } as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }

  const pose = Array.from({ length: 33 }, () => [0.5, 0.5, 0.9]);
  const hand = Array.from({ length: 21 }, (_, i) => [0.1 + i * 0.01, 0.2]);
  const replay = (mask: number): ReplayData => ({
    frame_count: 1, timestamps_ms: [0],
    pose: [pose], pose_mask: [mask],
    left_hand: [hand], left_mask: [0],
    right_hand: [hand], right_mask: [mask],
  });

  test("the image is mirrored", () => {
    const { ctx, calls } = fakeContext();
    drawFrame(ctx, replay(1), 0);
    // The first hand point is at x = 0.1, so the mirror puts it at 90 of 100.
    expect(calls).toContain("dot 90 16");
  });

  test("a frame with mask zero draws only the background", () => {
    const { ctx, calls } = fakeContext();
    drawFrame(ctx, replay(0), 0);
    expect(calls).toEqual(["clear", "background"]);
  });
});
