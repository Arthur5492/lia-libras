import { IconPlayerPlay } from "@tabler/icons-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { messageFor } from "../messages";
import { useNotify } from "../notifications";

/**
 * The video that shows a sign. It plays in a loop, without sound.
 * If the browser does not play it by itself, a play button comes over the video, and a video that cannot load
 * gives a notice. Both make the cause easy to see.
 */
export function ReferenceVideo({ src }: { src: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const notify = useNotify();
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    const element = video.current!;
    element.muted = true;
    element.setAttribute("muted", "");
    const play = () => element.play().then(() => setStopped(false), () => setStopped(true));
    void play();
    // Some browsers block autoplay. The first touch then starts the video.
    const onTouch = () => element.paused && void play();
    window.addEventListener("pointerdown", onTouch);
    return () => window.removeEventListener("pointerdown", onTouch);
  }, [src]);

  const start = (event: PointerEvent) => {
    // The touch is for the button, not for a card behind it.
    event.stopPropagation();
    void video.current?.play().then(() => setStopped(false), () => setStopped(true));
  };

  return (
    <>
      <video
        ref={video}
        src={src}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        onPlaying={() => setStopped(false)}
        onError={() => notify(messageFor("reference_video_error"))}
      />
      {stopped && (
        <button type="button" className="video-play" aria-label="Tocar o vídeo de exemplo" onPointerDown={start}>
          <IconPlayerPlay aria-hidden="true" />
        </button>
      )}
    </>
  );
}
