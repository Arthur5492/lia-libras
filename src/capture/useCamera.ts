import { useEffect, useRef, useState, type RefObject } from "react";
import { loadLandmarkers, startCamera, stopCamera, type Landmarkers } from "./recorder";

/**
 * Turn on the camera in a video element and load the detectors. `retry` tries again after a failure.
 * The camera turns off when the screen closes.
 */
export function useCamera(video: RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<"starting" | "ready" | "error">("starting");
  const [key, setKey] = useState(0);
  const landmarkers = useRef<Landmarkers | null>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    let active = true;
    setState("starting");
    (async () => {
      try {
        const marks = await loadLandmarkers();
        const media = await startCamera(video.current!);
        if (!active) {
          stopCamera(media);
          return;
        }
        landmarkers.current = marks;
        stream.current = media;
        setState("ready");
      } catch {
        if (active) setState("error");
      }
    })();
    return () => {
      active = false;
      stopCamera(stream.current);
      stream.current = null;
    };
  }, [key, video]);

  return { state, landmarkers, retry: () => setKey((k) => k + 1) };
}
