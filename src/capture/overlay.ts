// Draw the outline of the person over the camera preview, from the landmarks of the detectors.
import { bones, HAND_BONES, POSE_BONES, type Pen } from "../replay/draw";
import type { RawFrame } from "./pack";

const VISIBLE = 0.5;

/** Color of the outline of the body: neutral, or green when the person is in the picture, or red when not. */
export type Tone = "neutral" | "ok" | "bad";
const BODY_COLOR: Record<Tone, string> = { neutral: "#8a8f94", ok: "#3ddc84", bad: "#e5484d" };

/**
 * Draw one frame on a canvas that covers the preview. The video fills the preview with `object-fit: cover` and the
 * preview is mirrored, so the points use the same crop and the same mirror. Pass `null` to clear the canvas.
 */
export function drawLive(canvas: HTMLCanvasElement, video: HTMLVideoElement, frame: RawFrame | null, tone: Tone = "neutral"): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);
  if (!frame || !video.videoWidth || !video.videoHeight) return;

  const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
  const drawnWidth = video.videoWidth * scale;
  const drawnHeight = video.videoHeight * scale;
  const left = (width - drawnWidth) / 2;
  const top = (height - drawnHeight) / 2;
  const pen: Pen = (x, y) => [left + (1 - x) * drawnWidth, top + y * drawnHeight];

  if (frame.pose) {
    const pose = frame.pose.image.map((p) => [p.x, p.y, p.visibility ?? 0]);
    bones(ctx, pose, POSE_BONES, pen, BODY_COLOR[tone], (i) => POSE_BONES.some((pair) => pair.includes(i)) && pose[i][2] >= VISIBLE);
  }
  for (const hand of frame.hands) {
    bones(ctx, hand.image.map((p) => [p.x, p.y]), HAND_BONES, pen, "#e8e8e6", () => true);
  }
}
