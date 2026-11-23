import type { ModelMeta } from "./model";

/** The numbers that an admin can change while the recognizer runs. The window of the model is fixed. */
export interface Tuning {
  infer_every: number;
  stability: number;
  threshold: number;
  hand_lost_grace: number;
}

export const TUNING_LIMITS: Record<keyof Tuning, { min: number; max: number; step: number }> = {
  infer_every: { min: 1, max: 4, step: 1 },
  stability: { min: 1, max: 8, step: 1 },
  threshold: { min: 0.5, max: 0.99, step: 0.01 },
  hand_lost_grace: { min: 0, max: 60, step: 1 },
};

/** Keep a value inside its limits, and round it to its step. */
export function clampTuning(key: keyof Tuning, value: number): number {
  const { min, max, step } = TUNING_LIMITS[key];
  const rounded = Math.round(value / step) * step;
  return Number(Math.min(max, Math.max(min, rounded)).toFixed(2));
}

/** The values of the model package. */
export function defaultTuning(meta: ModelMeta): Tuning {
  return {
    infer_every: clampTuning("infer_every", meta.infer_every),
    stability: clampTuning("stability", meta.stability),
    threshold: clampTuning("threshold", meta.threshold),
    hand_lost_grace: clampTuning("hand_lost_grace", meta.hand_lost_grace),
  };
}

// The values are saved in the browser of the device, for each model. They are not shared with other devices.
const storageKey = (meta: ModelMeta) => `recognize-tuning:${meta.name}`;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The values to use: the ones saved on this device, over the values of the model package. */
export function loadTuning(meta: ModelMeta, store: Store = localStorage): Tuning {
  const tuning = defaultTuning(meta);
  try {
    const saved = JSON.parse(store.getItem(storageKey(meta)) ?? "{}") as Partial<Record<keyof Tuning, unknown>>;
    for (const key of Object.keys(tuning) as (keyof Tuning)[]) {
      const value = saved[key];
      if (typeof value === "number" && Number.isFinite(value)) tuning[key] = clampTuning(key, value);
    }
  } catch {
    // A saved text that is not valid is ignored, and the values of the model stay.
  }
  return tuning;
}

export function saveTuning(meta: ModelMeta, tuning: Tuning, store: Store = localStorage): void {
  store.setItem(storageKey(meta), JSON.stringify(tuning));
}

/** Forget the values of this device. The model package values come back. */
export function clearTuning(meta: ModelMeta, store: Store = localStorage): void {
  store.removeItem(storageKey(meta));
}
