import { useEffect, useRef } from "react";

/** The video that shows a sign. It plays in a loop, without sound. */
export function ReferenceVideo({ src }: { src: string }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current!;
    element.muted = true;
    const play = () => void element.play().catch(() => {});
    play();
    // Some phones block autoplay, for example with the battery saver on. The first touch then starts the video.
    const onTouch = () => element.paused && play();
    window.addEventListener("pointerdown", onTouch);
    return () => window.removeEventListener("pointerdown", onTouch);
  }, [src]);

  return <video ref={video} src={src} autoPlay loop muted playsInline preload="auto" />;
}
