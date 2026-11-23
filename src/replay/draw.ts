// Replay of a recording: choose the frame for a time, and draw the landmarks on a canvas.

/** Replay data from `GET /api/recordings/:id/replay`. Coordinates are in image units (0 to 1). */
export interface ReplayData {
  frame_count: number;
  timestamps_ms: number[];
  pose: number[][][]; // [frame][point][x, y, visibility]
  pose_mask: number[];
  left_hand: number[][][]; // [frame][point][x, y]
  left_mask: number[];
  right_hand: number[][][];
  right_mask: number[];
}

// Pairs of pose points that make the upper body and the arms. The face is not drawn.
export const POSE_BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22],
];

export const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const VISIBLE = 0.5;

/** Index of the last frame with a time that is not after `t`. `t` is in milliseconds. */
export function frameAt(timestamps: number[], t: number): number {
  let index = 0;
  for (let i = 0; i < timestamps.length; i += 1) {
    if (timestamps[i] <= t) index = i;
    else break;
  }
  return index;
}

/** Total time of the recording, in milliseconds. */
export function duration(timestamps: number[]): number {
  return timestamps.length > 0 ? timestamps[timestamps.length - 1] : 0;
}

export type Pen = (x: number, y: number) => [number, number];

export function bones(
  ctx: CanvasRenderingContext2D, points: number[][], pairs: [number, number][], pen: Pen, color: string,
  visible: (index: number) => boolean,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [a, b] of pairs) {
    if (!visible(a) || !visible(b)) continue;
    ctx.moveTo(...pen(points[a][0], points[a][1]));
    ctx.lineTo(...pen(points[b][0], points[b][1]));
  }
  ctx.stroke();
  points.forEach((point, i) => {
    if (!visible(i)) return;
    const [x, y] = pen(point[0], point[1]);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Draw one frame. The image is mirrored, as in the camera preview. */
export function drawFrame(ctx: CanvasRenderingContext2D, replay: ReplayData, frame: number): void {
  const { width, height } = ctx.canvas;
  const pen: Pen = (x, y) => [(1 - x) * width, y * height];
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#121518";
  ctx.fillRect(0, 0, width, height);
  if (replay.pose_mask[frame]) {
    const pose = replay.pose[frame];
    bones(ctx, pose, POSE_BONES, pen, "#8a8f94", (i) => POSE_BONES.some((p) => p.includes(i)) && pose[i][2] >= VISIBLE);
  }
  if (replay.left_mask[frame]) bones(ctx, replay.left_hand[frame], HAND_BONES, pen, "#e8e8e6", () => true);
  if (replay.right_mask[frame]) bones(ctx, replay.right_hand[frame], HAND_BONES, pen, "#e8e8e6", () => true);
}
