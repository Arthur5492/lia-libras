import { useEffect, useRef } from "react";
import { drawFrame, duration, frameAt, type ReplayData } from "../replay/draw";

/** Play a replay in a loop on a canvas, with the real time of each frame. */
export function Player({ replay }: { replay: ReplayData }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvas.current!.getContext("2d")!;
    const total = Math.max(duration(replay.timestamps_ms), 1);
    const start = performance.now();
    let id = 0;
    const step = () => {
      const t = (performance.now() - start) % total;
      drawFrame(ctx, replay, frameAt(replay.timestamps_ms, t));
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [replay]);

  return <canvas ref={canvas} width={320} height={240} />;
}
