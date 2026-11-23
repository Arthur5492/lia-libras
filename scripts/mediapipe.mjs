// Put the MediaPipe files in public/mediapipe/, so the site serves them and no outside server is needed.
// The wasm files come from the npm package, so their version always matches the code.
// The model files come from Google once, then stay in the folder. Run by `predev` and `prebuild`.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

const OUT = "public/mediapipe";
const MODELS = {
  "hand_landmarker.task":
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  "pose_landmarker_lite.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
};

mkdirSync(`${OUT}/models`, { recursive: true });
cpSync("node_modules/@mediapipe/tasks-vision/wasm", `${OUT}/wasm`, { recursive: true });

for (const [name, url] of Object.entries(MODELS)) {
  const path = `${OUT}/models/${name}`;
  if (existsSync(path)) continue;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download of ${name} failed: HTTP ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  console.log(`Downloaded ${name}`);
}
