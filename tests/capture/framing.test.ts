import { describe, expect, test } from "vitest";
import { emptyHand, POSE_DIMS, POSE_POINTS, WORLD_DIMS, type Capture } from "../../shared/capture";
import { framingCoverage, framingFlags, missingInFrame, saveFlags } from "../../shared/framing";
import { recordingMetrics } from "../../shared/metrics";

type Pose = { x: number; y: number; visibility?: number }[];

/** A pose with all the points in the middle and visible. `hide` lists points that the detector lost. */
function pose(hide: number[] = []): Pose {
  return Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: 0.5, visibility: hide.includes(i) ? 0.2 : 0.9 }));
}

describe("missingInFrame", () => {
  test("a person with the shoulders and the arms", () => {
    expect(missingInFrame(pose())).toBeNull();
  });

  test("no pose means that the shoulders are missing", () => {
    expect(missingInFrame(undefined)).toBe("shoulders");
  });

  test("a lost shoulder", () => {
    expect(missingInFrame(pose([11]))).toBe("shoulders");
    expect(missingInFrame(pose([12]))).toBe("shoulders");
  });

  test("the face does not matter", () => {
    expect(missingInFrame(pose([0, 1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });

  test("one arm is enough", () => {
    expect(missingInFrame(pose([13, 15]))).toBeNull();
    expect(missingInFrame(pose([14, 16]))).toBeNull();
  });

  test("an arm needs the elbow and the wrist", () => {
    expect(missingInFrame(pose([13, 16]))).toBe("arms");
    expect(missingInFrame(pose([13, 14, 15, 16]))).toBe("arms");
  });

  test("a point outside the picture is not visible", () => {
    const outside = pose();
    outside[15] = { x: 0.5, y: 1.2, visibility: 0.9 };
    outside[16] = { x: -0.1, y: 0.5, visibility: 0.9 };
    expect(missingInFrame(outside)).toBe("arms");
  });
});

/** A capture with `n` frames. `lost(i)` lists the points that the detector lost in frame i. `null` means no pose at all. */
function capture(n: number, lost: (i: number) => number[] | null): Capture {
  const result: Capture = {
    frameCount: n,
    timestamps: Float32Array.from({ length: n }, (_, i) => i * 50),
    pose: new Float32Array(n * POSE_POINTS * POSE_DIMS),
    poseWorld: new Float32Array(n * POSE_POINTS * WORLD_DIMS),
    poseMask: new Uint8Array(n),
    hands: [emptyHand(n), emptyHand(n)],
  };
  for (let i = 0; i < n; i += 1) {
    const hide = lost(i);
    if (hide === null) continue;
    result.poseMask[i] = 1;
    for (let j = 0; j < POSE_POINTS; j += 1) {
      result.pose.set([0.5, 0.5, 0, hide.includes(j) ? 0.2 : 0.9], (i * POSE_POINTS + j) * POSE_DIMS);
    }
  }
  return result;
}

describe("framingCoverage", () => {
  test("all the frames are good", () => {
    const result = framingCoverage(capture(20, () => []));
    expect(result).toEqual({ rate: 1, missing: null });
    expect(framingFlags(capture(20, () => []))).toEqual([]);
  });

  test("a few lost frames do not fail the recording", () => {
    const flagged = framingFlags(capture(20, (i) => (i < 6 ? [11] : [])));
    expect(flagged).toEqual([]);
  });

  test("too many lost frames fail the recording and tell what was missing", () => {
    const lost = capture(20, (i) => (i < 10 ? [15, 16] : []));
    expect(framingFlags(lost)).toEqual(["low_framing"]);
    expect(framingCoverage(lost)).toEqual({ rate: 0.5, missing: "arms" });
  });

  test("frames without a pose count as missing shoulders", () => {
    const result = framingCoverage(capture(10, (i) => (i < 5 ? null : [])));
    expect(result).toEqual({ rate: 0.5, missing: "shoulders" });
  });
});

describe("saveFlags", () => {
  test("a person who is in the picture has no flag about the pose", () => {
    // This fake capture has no hands, so only the flag about the hands is left.
    const good = capture(20, () => []);
    expect(saveFlags(good, recordingMetrics(good))).toEqual(["low_any_hand_rate"]);
  });

  test("the framing is flagged when the pose is there but the shoulders are not visible", () => {
    const hidden = capture(20, () => [11]);
    expect(saveFlags(hidden, recordingMetrics(hidden))).toContain("low_framing");
  });

  test("the framing is not flagged again when the pose rate already is", () => {
    const missing = capture(20, (i) => (i < 10 ? null : []));
    const flags = saveFlags(missing, recordingMetrics(missing));
    expect(flags).toContain("low_pose_rate");
    expect(flags).not.toContain("low_framing");
  });
});
