// Camera and MediaPipe detectors. The video never leaves the device: only landmarks are sent.
import { FilesetResolver, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { RawFrame } from "./pack";

// The detector files load from public CDNs. To serve them from this site, change these three constants.
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

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
 * Detect on each new video frame for `durationMs`. The time of each frame comes from performance.now(),
 * so it always goes up, as the detectors need.
 */
export function recordFrames(video: HTMLVideoElement, landmarkers: Landmarkers, durationMs: number): Promise<RawFrame[]> {
  return new Promise((resolve, reject) => {
    const frames: RawFrame[] = [];
    const start = performance.now();
    let lastVideoTime = -1;
    let lastT = -1;
    const step = () => {
      const now = performance.now();
      if (now - start >= durationMs) return resolve(frames);
      try {
        if (video.currentTime !== lastVideoTime && now > lastT) {
          lastVideoTime = video.currentTime;
          lastT = now;
          frames.push(detect(video, landmarkers, now));
        }
      } catch (error) {
        return reject(error);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
