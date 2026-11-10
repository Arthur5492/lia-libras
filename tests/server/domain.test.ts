// Tests without emulators: hands, upload format, .npz format, metrics and names.
import { describe, expect, test } from "vitest";
import {
  CaptureError, decodeCapture, encodeCapture, floatsToBase64, LABEL_LEFT, LEFT, RIGHT,
} from "../../shared/capture";
import { activeHand, assignHands } from "../../shared/hands";
import { assessReference, basicFlags, buildProfile, recordingMetrics } from "../../shared/metrics";
import { NamingError, slugify, usernameKey } from "../../shared/naming";
import { readNpz, replayPayload, writeNpz } from "../../server/npz";
import { makeCapture } from "./helpers";

const sum = (mask: Uint8Array) => mask.reduce((a, b) => a + b, 0);

describe("hand rule", () => {
  test("a hand in the wrong channel moves to the correct wrist", () => {
    const result = assignHands(makeCapture({ swapChannels: true }));
    expect(sum(result.hands[RIGHT].mask)).toBe(40);
    expect(sum(result.hands[LEFT].mask)).toBe(0);
    // The detector label and score move with the hand.
    expect(result.hands[RIGHT].labels[0]).toBe(LABEL_LEFT);
    expect(result.hands[RIGHT].scores[0]).toBeCloseTo(0.9);
  });

  test("two hands never share a channel", () => {
    const result = assignHands(makeCapture({ twoHands: true, swapChannels: true }));
    expect(sum(result.hands[LEFT].mask)).toBe(40);
    expect(sum(result.hands[RIGHT].mask)).toBe(40);
    expect(result.hands[LEFT].image[0]).toBeCloseTo(0.65);
  });

  test("the assignment is idempotent", () => {
    const once = assignHands(makeCapture({ twoHands: true, swapChannels: true }));
    const twice = assignHands(once);
    expect(twice.hands[LEFT].image).toEqual(once.hands[LEFT].image);
    expect(twice.hands[RIGHT].image).toEqual(once.hands[RIGHT].image);
    expect(twice.hands[RIGHT].labels).toEqual(once.hands[RIGHT].labels);
  });

  test("frames without a pose keep the continuity", () => {
    const capture = makeCapture({ twoHands: true });
    for (let i = 10; i < 15; i += 1) capture.poseMask[i] = 0;
    // Swap the channels in the frames without a pose.
    const [left, right] = capture.hands;
    for (let i = 10; i < 15; i += 1) {
      const a = left.image.slice(i * 63, (i + 1) * 63);
      left.image.set(right.image.subarray(i * 63, (i + 1) * 63), i * 63);
      right.image.set(a, i * 63);
    }
    const result = assignHands(capture);
    for (let i = 10; i < 15; i += 1) expect(result.hands[LEFT].image[i * 63]).toBeCloseTo(0.65);
  });

  test("no pose and no history keeps the source channel", () => {
    const result = assignHands(makeCapture({ poseMissing: 40 }));
    expect(sum(result.hands[RIGHT].mask)).toBe(40);
    expect(sum(result.hands[LEFT].mask)).toBe(0);
  });

  test("active hand", () => {
    expect(activeHand(makeCapture({ twoHands: true }))).toBe("right");
    expect(activeHand(makeCapture({ handMissing: 40 }))).toBe("unknown");
  });
});

describe("upload format", () => {
  test("encode and decode give the same capture", () => {
    const capture = makeCapture({ twoHands: true });
    const decoded = decodeCapture(encodeCapture(capture));
    expect(decoded.pose).toEqual(capture.pose);
    expect(decoded.hands[RIGHT].world).toEqual(capture.hands[RIGHT].world);
    expect(decoded.hands[LEFT].scores).toEqual(capture.hands[LEFT].scores);
    expect(decoded.timestamps).toEqual(capture.timestamps);
  });

  test.each([
    ["invalid_frame_count", (b: any) => { b.frame_count = 10; }],
    ["invalid_frame_count", (b: any) => { b.frame_count = 500; }],
    ["invalid_pose_shape", (b: any) => { b.pose = floatsToBase64(new Float32Array(8)); }],
    ["invalid_pose_values", (b: any) => {
      const bad = makeCapture().pose;
      bad[5] = Number.NaN;
      b.pose = floatsToBase64(bad);
    }],
    ["invalid_timestamps_values", (b: any) => { b.timestamps_ms = floatsToBase64(new Float32Array(40)); }],
    ["invalid_left_mask", (b: any) => { b.left_mask = 5; }],
    ["invalid_hand_labels_values", (b: any) => { b.hand_labels = btoa(String.fromCharCode(...new Array(80).fill(9))); }],
  ])("rejects %s", (code, change) => {
    const body = encodeCapture(makeCapture());
    change(body);
    expect(() => decodeCapture(body)).toThrowError(new CaptureError(code));
  });

  test("data of masked frames becomes zero", () => {
    const capture = makeCapture();
    capture.poseMask[3] = 0;
    const decoded = decodeCapture(encodeCapture(capture));
    expect(decoded.pose[3 * 33 * 4]).toBe(0);
  });
});

describe("npz", () => {
  test("write and read give the same capture", () => {
    const capture = assignHands(makeCapture({ twoHands: true }));
    const bytes = writeNpz(capture, {
      capture_version: "test", sign_id: "sign", video_idx: 2, duration_ms: 1950, video_width: 640, video_height: 480,
    });
    const { capture: back, meta } = readNpz(bytes);
    expect(meta).toMatchObject({ schema_version: "2.0", frame_count: 40, sign_id: "sign", video_idx: 2 });
    expect(back.pose).toEqual(capture.pose);
    expect(back.poseWorld).toEqual(capture.poseWorld);
    expect(back.hands[RIGHT].image).toEqual(capture.hands[RIGHT].image);
    expect(back.hands[LEFT].labels).toEqual(capture.hands[LEFT].labels);
    expect(back.timestamps).toEqual(capture.timestamps);
  });

  test("replay payload", () => {
    const replay = replayPayload(makeCapture());
    expect(replay.frame_count).toBe(40);
    expect(replay.pose[0][0]).toHaveLength(3);
    expect(replay.right_hand[0][0]).toHaveLength(2);
    expect(replay.timestamps_ms[1]).toBe(50);
  });
});

describe("metrics", () => {
  test("rates and flags", () => {
    const metrics = recordingMetrics(makeCapture({ poseMissing: 20, handMissing: 35 }));
    expect(metrics.pose_rate).toBe(0.5);
    expect(metrics.any_hand_rate).toBe(0.125);
    expect(basicFlags(metrics)).toEqual(["low_pose_rate", "low_any_hand_rate"]);
    expect(basicFlags(recordingMetrics(makeCapture()))).toEqual([]);
  });

  test("reference profile", () => {
    const moving = recordingMetrics(makeCapture());
    const profiles = { min_references: 3, profiles: { s: buildProfile([moving, moving, moving]) } };
    expect(assessReference(moving, profiles, "s").validation_flags).toEqual([]);
    const still = assessReference(recordingMetrics(makeCapture({ still: true })), profiles, "s");
    expect(still.validation_flags).toContain("low_motion_reference");
    expect(assessReference(moving, profiles, "other").reference_count).toBe(0);
  });
});

describe("names", () => {
  test("username", () => {
    expect(usernameKey("José_1")).toBe("jose_1");
    for (const bad of ["ab", "nome com espaço", "x".repeat(21), "日本語語"]) {
      expect(() => usernameKey(bad)).toThrowError(NamingError);
    }
    expect(() => usernameKey("Admin")).toThrowError(new NamingError("blocked_username"));
    expect(() => usernameKey("feio_demais", ["feio"])).toThrowError(new NamingError("blocked_username"));
  });

  test("slug", () => {
    expect(slugify("À vista")).toBe("a-vista");
    expect(slugify("Letra A")).toBe("letra-a");
  });
});
