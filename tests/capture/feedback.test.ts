// Tests for the messages shown when a recording is not good enough.
import { describe, expect, test } from "vitest";
import { describeFewFrames, describeProblems } from "../../src/capture/feedback";

describe("feedback", () => {
  test("a failure shows the measured value, the minimum and what to do", () => {
    const [pose, hands] = describeProblems(["low_pose_rate", "low_any_hand_rate"], { pose_rate: 0.35, any_hand_rate: 0.1 });
    expect(pose).toContain("35%");
    expect(pose).toContain("mínimo 80%");
    expect(pose).toContain("Afaste");
    expect(hands).toContain("10%");
    expect(hands).toContain("mínimo 30%");
  });

  test("it works without the measured values and ignores unknown flags", () => {
    expect(describeProblems(["low_pose_rate"])[0]).not.toContain("undefined");
    expect(describeProblems(["low_motion_reference"])).toEqual([]);
  });

  test("few frames show the count and the minimum", () => {
    const text = describeFewFrames(9, 3.8);
    expect(text).toContain("9 quadros");
    expect(text).toContain("3.8 s");
    expect(text).toContain("mínimo 15");
  });
});
