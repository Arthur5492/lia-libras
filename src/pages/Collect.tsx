import { useEffect, useRef, useState } from "react";
import { encodeCapture } from "../../shared/capture";
import { api, ApiError, errorMessage, type NextSigns } from "../api";
import { useAuth } from "../auth";
import { packFrames } from "../capture/pack";
import { loadLandmarkers, recordFrames, startCamera, stopCamera, type Landmarkers } from "../capture/recorder";

const CAPTURE_VERSION = "pwa-0.1.0";
const RECORD_MS = 2000;
const COUNTDOWN = 3;

type Phase = "idle" | "starting" | "ready" | "countdown" | "recording" | "sending";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function Collect() {
  const { setProfile } = useAuth();
  const [session, setSession] = useState<NextSigns | null>(null);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const landmarkers = useRef<Landmarkers | null>(null);
  // The same id for each retry of one recording, so the server does not save it twice.
  const clientId = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    api.nextSigns(5).then(setSession).catch((e) => setMessage(errorMessage(e)));
    return () => stopCamera(stream.current);
  }, []);

  async function turnOn() {
    setPhase("starting");
    setMessage("");
    try {
      landmarkers.current = await loadLandmarkers();
      stream.current = await startCamera(video.current!);
      setPhase("ready");
    } catch {
      setMessage("Não foi possível ligar a câmera. Permita o acesso à câmera e tente de novo.");
      setPhase("idle");
    }
  }

  async function record() {
    const sign = session?.signs[index];
    if (!sign || !video.current || !landmarkers.current) return;
    setSaved(false);
    setMessage("");
    try {
      setPhase("countdown");
      for (let i = COUNTDOWN; i > 0; i -= 1) {
        setCount(i);
        await wait(1000);
      }
      setPhase("recording");
      const frames = await recordFrames(video.current, landmarkers.current, RECORD_MS);
      const capture = packFrames(frames);
      if (capture.frameCount < 15) throw new Error("few_frames");
      setPhase("sending");
      await api.upload({
        client_id: clientId.current,
        sign_id: sign.id,
        capture_version: CAPTURE_VERSION,
        meta: {
          duration_ms: Math.round(capture.timestamps[capture.frameCount - 1]),
          video_width: video.current.videoWidth,
          video_height: video.current.videoHeight,
        },
        ...encodeCapture(capture),
      });
      clientId.current = crypto.randomUUID();
      setProfile(await api.me());
      setSaved(true);
      setMessage("Gravação salva.");
    } catch (error) {
      if (error instanceof Error && error.message === "few_frames") {
        setMessage("O aparelho processou poucos quadros. Tente de novo.");
      } else if (error instanceof ApiError && error.code === "low_quality") {
        // The server did not save it, so a new try is a new recording.
        clientId.current = crypto.randomUUID();
        setMessage(errorMessage(error));
      } else {
        setMessage(errorMessage(error));
      }
    } finally {
      setPhase("ready");
    }
  }

  function next() {
    setSaved(false);
    setMessage("");
    setIndex((i) => i + 1);
  }

  if (!session) return <main className="page"><p className="muted">{message || "Carregando…"}</p></main>;
  const sign = session.signs[index];

  if (!sign) {
    return (
      <main className="page">
        <h1>Coletar</h1>
        <p>
          {session.signs.length === 0
            ? "Você completou todos os sinais disponíveis. Obrigado!"
            : "Sessão terminada. Obrigado!"}
        </p>
        <button className="button button--primary" onClick={() => window.location.reload()}>Nova sessão</button>
      </main>
    );
  }

  const busy = phase !== "ready";
  return (
    <main className="page">
      <h1>{sign.name}</h1>
      <p className="muted">Sinal {index + 1} de {session.signs.length} nesta sessão.</p>
      <video src={sign.video_url} controls loop muted playsInline width={320} />
      <div>
        <video ref={video} muted playsInline width={320} style={{ transform: "scaleX(-1)" }} />
      </div>
      {phase === "countdown" && <p>Começa em {count}…</p>}
      {phase === "recording" && <p>Gravando…</p>}
      {phase === "sending" && <p>Enviando…</p>}
      {message && <p className={saved ? "ok" : "form-error"} role="status">{message}</p>}
      {phase === "idle" && <button className="button button--primary" onClick={turnOn}>Ligar a câmera</button>}
      {phase === "starting" && <p className="muted">Carregando o detector…</p>}
      {phase !== "idle" && phase !== "starting" && (
        <>
          <button className="button button--primary" onClick={record} disabled={busy}>
            {saved ? "Gravar de novo" : "Gravar"}
          </button>
          <button className="button button--quiet" onClick={next} disabled={busy}>Próximo sinal</button>
        </>
      )}
    </main>
  );
}
