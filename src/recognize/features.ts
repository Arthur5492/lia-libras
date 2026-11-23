import { assignHands } from "../../shared/hands";
import { packFrames, type RawFrame } from "../capture/pack";
import { frameFeatures } from "./imageFeatures";

/** Turns the last frames of the detectors into one vector of numbers for each frame. */
export type FeaturesOf = (frames: RawFrame[]) => Float32Array[];

/**
 * The code that makes the features for a version of the features. A model package says which version it needs
 * in `meta.json`. A new model with new features adds a version here.
 */
export function featuresFor(version: string): FeaturesOf {
  if (version === "image-v1") {
    return (frames) => {
      const capture = assignHands(packFrames(frames));
      return Array.from({ length: capture.frameCount }, (_, i) => frameFeatures(capture, i));
    };
  }
  throw new Error(`Unknown feature version: ${version}`);
}
