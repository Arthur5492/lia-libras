// Load the demo model (TensorFlow.js layers format) and run it. TensorFlow.js loads only when needed.
import type { LayersModel } from "@tensorflow/tfjs";

export interface DemoModel {
  classes: string[];
  layers: LayersModel;
}

type Tf = typeof import("@tensorflow/tfjs");
let tf: Tf | undefined;

/** Load the model from `base` (a URL folder). Throw if the files are not there. */
export async function loadDemoModel(base = "/demo-model"): Promise<DemoModel> {
  const check = await fetch(`${base}/model.json`);
  if (!check.ok || !(check.headers.get("content-type") ?? "").includes("json")) throw new Error("missing");
  const classes = (await (await fetch(`${base}/classes.json`)).json()) as string[];
  tf ??= await import("@tensorflow/tfjs");
  return { classes, layers: await tf.loadLayersModel(`${base}/model.json`) };
}

/** Probability for each class. `sequence` has one feature vector per frame. */
export function predict(model: DemoModel, sequence: Float32Array[]): Float32Array {
  const t = tf!;
  return t.tidy(() => {
    const input = t.tensor3d(sequence.map((row) => Array.from(row)).flat(), [1, sequence.length, sequence[0].length]);
    return Float32Array.from((model.layers.predict(input) as import("@tensorflow/tfjs").Tensor).dataSync());
  });
}
