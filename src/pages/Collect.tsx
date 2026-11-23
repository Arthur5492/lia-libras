import { IconCheck, IconChevronsRight, IconInfoSmall, IconTrash, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { encodeCapture, MIN_FRAMES } from "../../shared/capture";
import { assignHands } from "../../shared/hands";
import { basicFlags, recordingMetrics } from "../../shared/metrics";
import { api, ApiError, errorMessage, type NextSigns } from "../api";
import { useAuth, useProfile } from "../auth";
import { drawLive } from "../capture/overlay";
import { packFrames } from "../capture/pack";
import { loadLandmarkers, recordFrames, startCamera, stopCamera, watchFrames, type Landmarkers } from "../capture/recorder";
import { GestureEngine } from "../gestures/engine";
import { BOTH_HANDS_OPEN } from "../gestures/rules";
import { messageFor } from "../messages";
import { useNotify } from "../notifications";
import { RecordButton } from "../ui/RecordButton";
import { RoundButton } from "../ui/RoundButton";
import { Sheet } from "../ui/Sheet";

const CAPTURE_VERSION = "pwa-0.2.0";
const COUNTDOWN = 3;
const RECORD_MS = 2000;
// The server rejects a capture longer than 4000 ms, so stop before that.
const RECORD_MAX_MS = 3800;
const OK_MS = 1000;
const BAD_MS = 1800;

type Phase = "starting" | "ready" | "countdown" | "recording" | "result" | "error";

interface Result {
  ok: boolean;
  text?: string;
}

/** A recording that the person made in this session. `upload` gives the id of the recording, or null if the upload failed. */
interface Saved {
  signIndex: number;
  signId: string;
  upload: Promise<string | null>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Text for the error of an upload or a check. */
function failureText(error: unknown): string {
  if (error instanceof ApiError && error.code === "low_quality") {
    return ((error.detail.validation_flags as string[]) ?? ["low_quality"]).map(messageFor).join(" ");
  }
  return errorMessage(error);
}

export function Collect() {
  const profile = useProfile();
  const { setProfile } = useAuth();
  const notify = useNotify();

  const [session, setSession] = useState<NextSigns | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<Phase>("starting");
  const [count, setCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [help, setHelp] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const landmarkers = useRef<Landmarkers | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const stopWatch = useRef<(() => void) | null>(null);
  const saved = useRef<Saved[]>([]);
  const run = useRef(0);
  // Values that the callbacks of the gesture engine and of the timers must read when they run, not when they were made.
  const live = useRef({ phase, sign: undefined as NextSigns["signs"][number] | undefined, index, done });
  const engine = useRef<GestureEngine | null>(null);
  const begin = useRef<() => void>(() => {});

  const sign = session?.signs[index];
  live.current = { phase, sign, index, done };
  engine.current ??= new GestureEngine([BOTH_HANDS_OPEN], {
    onProgress: (_, value) => setProgress(value),
    onTrigger: () => begin.current(),
  });

  // The session: the signs to record now.
  useEffect(() => {
    let active = true;
    setSession(null);
    setLoadError("");
    api.nextSigns(5)
      .then((next) => {
        if (!active) return;
        setSession(next);
        setIndex(0);
        setDone(Object.fromEntries(next.signs.map((s) => [s.id, profile.sign_recordings[s.id]?.length ?? 0])));
      })
      .catch((error) => active && setLoadError(errorMessage(error)));
    return () => {
      active = false;
    };
    // The profile is read once, at the start of the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  // The camera and the detectors.
  useEffect(() => {
    let active = true;
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
        setPhase("ready");
      } catch {
        if (active) setPhase("error");
      }
    })();
    return () => {
      active = false;
      stopWatch.current?.();
      stopCamera(stream.current);
    };
  }, []);

  // While the screen waits, and during the countdown, draw the outline of the person. Only a waiting screen looks for the gesture.
  useEffect(() => {
    if (phase !== "ready" && phase !== "countdown") return;
    const marks = landmarkers.current;
    const camera = video.current;
    const canvas = overlay.current;
    if (!marks || !camera || !canvas) return;
    if (phase === "ready") engine.current!.reset();
    const stop = watchFrames(camera, marks, (frame) => {
      drawLive(canvas, camera, frame);
      if (live.current.phase === "ready") engine.current!.push({ t: frame.t, hands: frame.hands.map((hand) => hand.image) });
    });
    stopWatch.current = stop;
    return () => {
      stop();
      stopWatch.current = null;
      if (phase === "ready") setProgress(0);
    };
  }, [phase]);

  async function startRecording() {
    const { phase: now, sign: current, index: at, done: counts } = live.current;
    const marks = landmarkers.current;
    const camera = video.current;
    if (now !== "ready" || !current || !marks || !camera) return;
    const id = ++run.current;
    const active = () => id === run.current;

    setResult(null);
    setPhase("countdown");
    setProgress(1);
    for (let n = COUNTDOWN; n >= 1; n -= 1) {
      setCount(n);
      await wait(1000);
      if (!active()) return;
    }

    // Only one loop can use the detectors at a time.
    stopWatch.current?.();
    stopWatch.current = null;
    setProgress(0);
    setPhase("recording");

    const finish = async (outcome: Result) => {
      setResult(outcome);
      setPhase("result");
      await wait(outcome.ok ? OK_MS : BAD_MS);
      setResult(null);
      setPhase("ready");
    };

    try {
      const frames = await recordFrames(camera, marks, { durationMs: RECORD_MS, minFrames: MIN_FRAMES, maxMs: RECORD_MAX_MS },
        (frame) => overlay.current && drawLive(overlay.current, camera, frame));
      const capture = packFrames(frames);
      if (capture.frameCount < MIN_FRAMES) return await finish({ ok: false, text: messageFor("few_frames") });
      // Same rules as the server. The server still decides, but the person sees the reason at once.
      const flags = basicFlags(recordingMetrics(assignHands(capture)));
      if (flags.length > 0) return await finish({ ok: false, text: flags.map(messageFor).join(" ") });

      const entry: Saved = {
        signIndex: at,
        signId: current.id,
        upload: api
          .upload({
            client_id: crypto.randomUUID(),
            sign_id: current.id,
            capture_version: CAPTURE_VERSION,
            meta: {
              duration_ms: Math.round(capture.timestamps[capture.frameCount - 1]),
              video_width: camera.videoWidth,
              video_height: camera.videoHeight,
            },
            ...encodeCapture(capture),
          })
          .then(async (response) => {
            setProfile(await api.me());
            return response.recording.id;
          })
          .catch((error) => {
            // The upload runs while the person records the next one, so the failure comes as a notice.
            saved.current = saved.current.filter((item) => item !== entry);
            setCanUndo(saved.current.length > 0);
            setDone((d) => ({ ...d, [current.id]: Math.max(0, (d[current.id] ?? 0) - 1) }));
            notify(failureText(error));
            return null;
          }),
      };
      saved.current.push(entry);
      setCanUndo(true);
      const total = (counts[current.id] ?? 0) + 1;
      setDone((d) => ({ ...d, [current.id]: (d[current.id] ?? 0) + 1 }));
      const complete = total >= (session?.target_per_sign ?? Infinity);
      await finish({ ok: true });
      if (complete) setIndex((i) => i + 1);
    } catch (error) {
      await finish({ ok: false, text: error instanceof ApiError ? failureText(error) : messageFor("camera_error") });
    }
  }
  begin.current = startRecording;

  function cancelCountdown() {
    if (live.current.phase !== "countdown") return;
    run.current += 1;
    setProgress(0);
    setPhase("ready");
  }

  function onRecordButton() {
    if (phase === "countdown") cancelCountdown();
    else void startRecording();
  }

  async function undo() {
    if (phase !== "ready") return;
    const last = saved.current.pop();
    if (!last) return;
    setCanUndo(saved.current.length > 0);
    setIndex(last.signIndex);
    setDone((d) => ({ ...d, [last.signId]: Math.max(0, (d[last.signId] ?? 0) - 1) }));
    const id = await last.upload;
    if (!id) return;
    try {
      await api.deleteRecording(id);
      setProfile(await api.me());
    } catch (error) {
      // The recording is still on the server, so it counts again.
      saved.current.push(last);
      setCanUndo(true);
      setDone((d) => ({ ...d, [last.signId]: (d[last.signId] ?? 0) + 1 }));
      notify(errorMessage(error));
    }
  }

  function skip() {
    if (phase === "ready") setIndex((i) => i + 1);
  }

  const ready = phase === "ready";
  const target = session?.target_per_sign ?? 4;
  return (
    <main className="screen collect">
      <section className="panel" aria-label="Vídeo de referência">
        {sign && <video key={sign.id} src={sign.video_url} autoPlay loop muted playsInline />}
        {!session && !loadError && <p className="panel__note">Carregando…</p>}
        {loadError && <p className="panel__note" role="alert">{loadError}</p>}
        {session && !sign && (
          <div className="panel__note">
            <p>{session.signs.length === 0 ? "Você gravou todos os sinais disponíveis. Obrigado!" : "Sessão terminada. Obrigado!"}</p>
            <button type="button" className="button button--primary" onClick={() => setSessionKey((k) => k + 1)}>Nova sessão</button>
          </div>
        )}
      </section>

      <section className="panel panel--mirror" aria-label="Sua câmera">
        <video ref={video} muted playsInline />
        <canvas ref={overlay} />
        {phase === "starting" && <p className="panel__note">Ligando a câmera…</p>}
        {phase === "error" && (
          <div className="panel__note" role="alert">
            <p>{messageFor("camera_error")}</p>
            <button type="button" className="button button--primary" onClick={() => window.location.reload()}>Tentar de novo</button>
          </div>
        )}
        <div className="panel__fade" />
        {sign && <span className="chip">{Math.min((done[sign.id] ?? 0) + 1, target)} de {target}</span>}
      </section>

      {sign && <h1 className="sign-name">{sign.name}</h1>}
      <div className="row">
        <RoundButton size="sm" label="Apagar a última gravação" disabled={!ready || !canUndo} onClick={undo}><IconTrash aria-hidden="true" /></RoundButton>
        <RoundButton size="sm" label="Pular o sinal" disabled={!ready || !sign} onClick={skip}><IconChevronsRight aria-hidden="true" /></RoundButton>
        <RoundButton size="sm" bigIcon label="Como gravar" onClick={() => setHelp(true)}><IconInfoSmall aria-hidden="true" /></RoundButton>
      </div>
      <RecordButton
        progress={progress}
        recording={phase === "recording"}
        disabled={!sign || (phase !== "ready" && phase !== "countdown")}
        onClick={onRecordButton}
      />

      {phase === "countdown" && (
        <div className="dim" role="button" aria-label="Cancelar a contagem" onClick={cancelCountdown}>
          <div key={count} className="big-number pop">{count}</div>
          <p className="dim__hint">Toque para cancelar</p>
        </div>
      )}
      {phase === "recording" && <div className="frame frame--red" />}
      {phase === "result" && result && (
        <>
          <div className={`dim result ${result.ok ? "result--ok" : "result--bad"}`}>
            <div className="result__circle pop">{result.ok ? <IconCheck aria-hidden="true" /> : <IconX aria-hidden="true" />}</div>
            {result.text && <p className="result__text">{result.text}</p>}
          </div>
          {result.ok && <div className="frame frame--green" />}
        </>
      )}
      <p className="sr-only" role="status">
        {phase === "countdown" ? `Gravação começa em ${count}` : phase === "recording" ? "Gravando" : result?.ok ? "Gravação salva" : (result?.text ?? "")}
      </p>

      {help && (
        <Sheet title="Como gravar" onClose={() => setHelp(false)}>
          <ol className="steps">
            <li>Fique de pé, longe o bastante para aparecer da cintura para cima.</li>
            <li>Mostre as duas mãos abertas e paradas até o anel do botão ficar todo vermelho. Ou toque no botão.</li>
            <li>Quando a contagem terminar, faça o sinal que aparece no nome.</li>
          </ol>
        </Sheet>
      )}
    </main>
  );
}
