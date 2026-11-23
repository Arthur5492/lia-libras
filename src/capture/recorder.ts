// Camera and MediaPipe detectors. The video never leaves the device: only landmarks are sent.
import { FilesetResolver, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { RawFrame } from "./pack";

// The site serves the detector files. scripts/mediapipe.mjs puts them in public/mediapipe/.
const WASM = "/mediapipe/wasm";
const HAND_MODEL = "/mediapipe/models/hand_landmarker.task";
const POSE_MODEL = "/mediapipe/models/pose_landmarker_lite.task";

export interface Landmarkers {
  hand: HandLandmarker;
  pose: PoseLandmarker;
}

let loading: Promise<Landmarkers> | undefined;

async function create(delegate: "GPU" | "CPU"): Promise<Landmarkers> {
  const files = await FilesetResolver.forVisionTasks(WASM);
  const [hand, pose] = await Promise.all([
    HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate },
      runningMode: "VIDEO",
      numHands: 2,
    }),
    PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
    }),
  ]);
  return { hand, pose };
}

/** Load the detectors once. Try the GPU first and use the CPU if the GPU fails. */
export function loadLandmarkers(): Promise<Landmarkers> {
  loading ??= create("GPU").catch(() => create("CPU")).catch((error) => {
    loading = undefined; // Allow a new try.
    throw error;
  });
  return loading;
}

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function detect(video: HTMLVideoElement, landmarkers: Landmarkers, t: number): RawFrame {
  const hands = landmarkers.hand.detectForVideo(video, t);
  const pose = landmarkers.pose.detectForVideo(video, t);
  return {
    t,
    pose: pose.landmarks[0] ? { image: pose.landmarks[0], world: pose.worldLandmarks[0] } : undefined,
    hands: hands.landmarks.map((image, i) => ({
      image,
      world: hands.worldLandmarks[i],
      label: hands.handedness[i]?.[0]?.categoryName ?? "",
      score: hands.handedness[i]?.[0]?.score ?? 0,
    })),
  };
}

/**
 * Detect on each new video frame. Stop after `durationMs`, but keep going until there are `minFrames`,
 * up to `maxMs`. A slow device (or a frame with no person, which is slower to detect) then still gets enough frames.
 * The time of each frame comes from performance.now(), so it always goes up, as the detectors need.
 */
export function recordFrames(
  video: HTMLVideoElement,
  landmarkers: Landmarkers,
  limits: { durationMs: number; minFrames: number; maxMs: number },
  /** Called for each detected frame, for example to draw the outline of the person. */
  onFrame?: (frame: RawFrame) => void,
): Promise<RawFrame[]> {
  return new Promise((resolve, reject) => {
    const frames: RawFrame[] = [];
    const start = performance.now();
    let lastVideoTime = -1;
    let lastT = -1;
    const step = () => {
      const now = performance.now();
      const elapsed = now - start;
      if (elapsed >= limits.maxMs || (elapsed >= limits.durationMs && frames.length >= limits.minFrames)) {
        return resolve(frames);
      }
      try {
        if (video.currentTime !== lastVideoTime && now > lastT) {
          lastVideoTime = video.currentTime;
          lastT = now;
          const frame = detect(video, landmarkers, now);
          frames.push(frame);
          onFrame?.(frame);
        }
      } catch (error) {
        return reject(error);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * Detect on the new video frames until the returned function is called. It does at most `fps` frames each second,
 * because a loop that never stops uses the battery. Do not run it at the same time as `recordFrames`.
 */
export function watchFrames(
  video: HTMLVideoElement,
  landmarkers: Landmarkers,
  onFrame: (frame: RawFrame) => void,
  fps = 12,
): () => void {
  let running = true;
  let lastVideoTime = -1;
  let lastT = -1;
  const gap = 1000 / fps;
  const step = () => {
    if (!running) return;
    const now = performance.now();
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastT >= gap) {
      lastVideoTime = video.currentTime;
      lastT = now;
      try {
        onFrame(detect(video, landmarkers, now));
      } catch {
        running = false;
        return;
      }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return () => {
    running = false;
  };
}
