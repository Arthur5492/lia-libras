// Draw the outline of the person over the camera preview, from the landmarks of the detectors.
import { bones, drawHand, POSE_BONES, type Pen } from "../replay/draw";
import type { RawFrame } from "./pack";

const VISIBLE = 0.5;
/** The lines are thick, because the person is far from the screen. */
const LINE = 3;

/** Color of the outline of the body: neutral, or green when the person is in the picture, or red when not. */
export type Tone = "neutral" | "ok" | "bad";
const BODY_COLOR: Record<Tone, string> = { neutral: "#8a8f94", ok: "#3ddc84", bad: "#e5484d" };

// The size of a canvas is read once and when it changes. Reading it for each frame would slow the drawing.
const sizes = new WeakMap<HTMLCanvasElement, { width: number; height: number }>();

function sizeOf(canvas: HTMLCanvasElement): { width: number; height: number } {
  let size = sizes.get(canvas);
  if (!size) {
    const fresh = { width: canvas.clientWidth, height: canvas.clientHeight };
    size = fresh;
    sizes.set(canvas, fresh);
    new ResizeObserver(() => {
      fresh.width = canvas.clientWidth;
      fresh.height = canvas.clientHeight;
    }).observe(canvas);
  }
  return size;
}

/**
 * Draw one frame on a canvas that covers the preview. The video fills the preview with `object-fit: cover` and the
 * preview is mirrored, so the points use the same crop and the same mirror. Pass `null` to clear the canvas.
 */
export function drawLive(canvas: HTMLCanvasElement, video: HTMLVideoElement, frame: RawFrame | null, tone: Tone = "neutral"): void {
  const { width, height } = sizeOf(canvas);
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
    bones(ctx, pose, POSE_BONES, pen, BODY_COLOR[tone], (i) => POSE_BONES.some((pair) => pair.includes(i)) && pose[i][2] >= VISIBLE, LINE);
  }
  for (const hand of frame.hands) {
    drawHand(ctx, hand.image.map((p) => [p.x, p.y]), pen, LINE);
  }
}
