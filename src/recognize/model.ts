// Load a model package and run it. TensorFlow.js loads only when a model is needed.
import type { LayersModel, Tensor } from "@tensorflow/tfjs";

/**
 * A model package is a folder with four files:
 * - `model.json` and its weights: the model in the TensorFlow.js layers format.
 * - `classes.json`: the signs, in the order of the outputs of the model.
 * - `meta.json`: how to use the model.
 */
export interface ModelMeta {
  /** The name that the screen shows. */
  name: string;
  /** Which code makes the features for this model (see features.ts). */
  feature_version: string;
  /** The number of frames that the model reads at a time. */
  frames: number;
  /** A sign counts only when its probability is above this. */
  threshold: number;
  /** A sign counts only after this number of predictions in a row give the same sign. */
  stability: number;
  /** The model runs on one frame in this number. */
  infer_every: number;
  /** The number of frames without a hand before the recognizer starts again. */
  hand_lost_grace: number;
}

export interface SignClass {
  slug: string;
  name: string;
}

export interface ModelPackage {
  meta: ModelMeta;
  classes: SignClass[];
  /** The probability of each sign, from the features of the last frames. */
  predict(features: Float32Array[]): Float32Array;
}

type Tf = typeof import("@tensorflow/tfjs");
let tf: Tf | undefined;

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  // The server answers a file that does not exist with the start page, which is not JSON.
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) throw new Error(`Missing ${url}`);
  return (await response.json()) as T;
}

/** Load the package in the folder `base`. It throws if a file is not there. */
export async function loadModelPackage(base = "/models/demo"): Promise<ModelPackage> {
  const [meta, classes] = await Promise.all([json<ModelMeta>(`${base}/meta.json`), json<SignClass[]>(`${base}/classes.json`)]);
  tf ??= await import("@tensorflow/tfjs");
  const layers: LayersModel = await tf.loadLayersModel(`${base}/model.json`);
  const t = tf;
  return {
    meta,
    classes,
    predict(features) {
      return t.tidy(() => {
        const width = features[0].length;
        const input = t.tensor3d(features.flatMap((row) => Array.from(row)), [1, features.length, width]);
        return Float32Array.from((layers.predict(input) as Tensor).dataSync());
      });
    },
  };
}
