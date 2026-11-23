import { IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { ReplayData } from "../replay/draw";
import { Player } from "./Player";

const MAX_SCALE = 6;
/** The scale of a double tap. */
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
/** A touch that moves less than this (in pixels) is a tap. */
const TAP_PX = 8;
/** The drawing is big, so it stays sharp when the person zooms. */
const RESOLUTION: [number, number] = [1600, 1200];

interface View {
  scale: number;
  /** The place of the top left corner of the drawing, in pixels. It is 0 or less. */
  x: number;
  y: number;
}

interface Start {
  distance: number;
  view: View;
  x: number;
  y: number;
}

/**
 * The replay of a recording on the whole screen. Two fingers zoom in and out and one finger moves the drawing.
 * A double tap zooms in and out, and the wheel of a mouse zooms. The X button, or the Escape key, closes it.
 */
export function ZoomViewer({ replay, onClose }: { replay: ReplayData; onClose(): void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const current = useRef(view);
  current.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<Start | null>(null);
  const moved = useRef(false);
  const lastTap = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Keep the drawing over the whole screen: no empty edge, and no more than the largest scale. */
  function fit(next: View): View {
    const box = stage.current!;
    const scale = Math.min(MAX_SCALE, Math.max(1, next.scale));
    return {
      scale,
      x: Math.min(0, Math.max(box.clientWidth - box.clientWidth * scale, next.x)),
      y: Math.min(0, Math.max(box.clientHeight - box.clientHeight * scale, next.y)),
    };
  }

  /** Zoom to `scale`, and keep the point (px, py) of the screen where it is. */
  function zoomAt(scale: number, px: number, py: number) {
    const now = current.current;
    const ratio = Math.min(MAX_SCALE, Math.max(1, scale)) / now.scale;
    setView(fit({ scale: now.scale * ratio, x: px - (px - now.x) * ratio, y: py - (py - now.y) * ratio }));
  }

  function place(event: { clientX: number; clientY: number }) {
    const box = stage.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  /** A new reference for the gesture, when a finger comes or goes. */
  function restart() {
    const points = [...pointers.current.values()];
    if (points.length === 0) {
      start.current = null;
      return;
    }
    const middle = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
    const distance = points.length >= 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
    start.current = { distance, view: current.current, x: middle.x, y: middle.y };
  }

  function onDown(event: PointerEvent) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is not active (it can happen with a pen or a test). The gesture still works.
    }
    pointers.current.set(event.pointerId, place(event));
    if (pointers.current.size === 1) moved.current = false;
    restart();
  }

  function onMove(event: PointerEvent) {
    if (!pointers.current.has(event.pointerId) || !start.current) return;
    pointers.current.set(event.pointerId, place(event));
    const points = [...pointers.current.values()];
    const origin = start.current;
    const middle = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
    if (Math.hypot(middle.x - origin.x, middle.y - origin.y) > TAP_PX) moved.current = true;
    if (points.length >= 2 && origin.distance > 0) {
      const scale = origin.view.scale * (Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / origin.distance);
      const ratio = Math.min(MAX_SCALE, Math.max(1, scale)) / origin.view.scale;
      // The point of the drawing that was under the fingers stays under them.
      setView(fit({
        scale: origin.view.scale * ratio,
        x: middle.x - (origin.x - origin.view.x) * ratio,
        y: middle.y - (origin.y - origin.view.y) * ratio,
      }));
      moved.current = true;
    } else {
      setView(fit({ ...origin.view, x: origin.view.x + middle.x - origin.x, y: origin.view.y + middle.y - origin.y }));
    }
  }

  function onUp(event: PointerEvent) {
    const was = pointers.current.get(event.pointerId);
    pointers.current.delete(event.pointerId);
    restart();
    if (!was || moved.current || pointers.current.size > 0) return;
    // A double tap: zoom in, or go back to the whole picture.
    const now = performance.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      if (current.current.scale > 1) setView({ scale: 1, x: 0, y: 0 });
      else zoomAt(DOUBLE_TAP_SCALE, was.x, was.y);
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  }

  function onWheel(event: WheelEvent) {
    const point = place(event);
    zoomAt(current.current.scale * (event.deltaY < 0 ? 1.2 : 1 / 1.2), point.x, point.y);
  }

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Gravação em tela cheia">
      <div
        ref={stage}
        className="viewer__stage"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        <div className="viewer__zoom" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <Player replay={replay} resolution={RESOLUTION} />
        </div>
      </div>
      <button type="button" className="viewer__close" aria-label="Fechar" onClick={onClose}>
        <IconX aria-hidden="true" />
      </button>
    </div>
  );
}
