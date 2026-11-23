import { describe, expect, test } from "vitest";
import type { ModelMeta } from "../../src/recognize/model";
import { clampTuning, clearTuning, defaultTuning, loadTuning, saveTuning } from "../../src/recognize/tuning";

const META: ModelMeta = {
  name: "Test model", feature_version: "image-v1", frames: 20, threshold: 0.9, stability: 5, infer_every: 2, hand_lost_grace: 30,
};

/** A small replacement for localStorage. */
function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

describe("tuning", () => {
  test("the values of the model are the default", () => {
    expect(defaultTuning(META)).toEqual({ infer_every: 2, stability: 5, threshold: 0.9, hand_lost_grace: 30 });
    expect(loadTuning(META, fakeStore())).toEqual(defaultTuning(META));
  });

  test("a value saved on the device is used, and the others stay", () => {
    const store = fakeStore();
    saveTuning(META, { infer_every: 1, stability: 3, threshold: 0.8, hand_lost_grace: 30 }, store);
    expect(loadTuning(META, store)).toEqual({ infer_every: 1, stability: 3, threshold: 0.8, hand_lost_grace: 30 });
    store.setItem("recognize-tuning:Test model", JSON.stringify({ stability: 2 }));
    expect(loadTuning(META, store)).toEqual({ ...defaultTuning(META), stability: 2 });
  });

  test("each model has its own values", () => {
    const store = fakeStore();
    saveTuning(META, { infer_every: 1, stability: 1, threshold: 0.5, hand_lost_grace: 0 }, store);
    expect(loadTuning({ ...META, name: "Other model" }, store)).toEqual(defaultTuning(META));
  });

  test("a value that is out of the limits is brought back, and a bad text is ignored", () => {
    const store = fakeStore({ "recognize-tuning:Test model": JSON.stringify({ stability: 99, threshold: 2, infer_every: "x" }) });
    expect(loadTuning(META, store)).toEqual({ infer_every: 2, stability: 8, threshold: 0.99, hand_lost_grace: 30 });
    expect(loadTuning(META, fakeStore({ "recognize-tuning:Test model": "not json" }))).toEqual(defaultTuning(META));
  });

  test("clear brings the model values back", () => {
    const store = fakeStore();
    saveTuning(META, { infer_every: 1, stability: 1, threshold: 0.5, hand_lost_grace: 0 }, store);
    clearTuning(META, store);
    expect(loadTuning(META, store)).toEqual(defaultTuning(META));
  });

  test("a value is rounded to its step", () => {
    expect(clampTuning("threshold", 0.876)).toBe(0.88);
    expect(clampTuning("stability", 3.4)).toBe(3);
    expect(clampTuning("hand_lost_grace", -5)).toBe(0);
  });
});
