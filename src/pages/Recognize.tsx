import { IconChevronDown, IconVolume, IconVolumeOff } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { missingInFrame } from "../../shared/framing";
import { FramingTracker, type Framing } from "../capture/framingTracker";
import { drawLive } from "../capture/overlay";
import { watchFrames } from "../capture/recorder";
import { useCamera } from "../capture/useCamera";
import { messageFor } from "../messages";
import { useNotify } from "../notifications";
import { featuresFor } from "../recognize/features";
import { loadModelPackage, type ModelPackage } from "../recognize/model";
import { Recognizer } from "../recognize/recognizer";
import { RoundButton } from "../ui/RoundButton";
import { Sheet } from "../ui/Sheet";

// The big word, and the words of the phrase, go away by themselves. The times here match the CSS animations.
const WORD_MS = 3000;
const PHRASE_MS = 8000;
const PHRASE_MAX = 5;
// The hint about the framing comes after this time, so a short loss does not show a message.
const HINT_DELAY_MS = 1500;

interface Spoken {
  id: number;
  text: string;
  at: number;
}

/** Say a text aloud, in Brazilian Portuguese. */
function say(text: string): void {
  if (!("speechSynthesis" in window)) return;
  const speech = new SpeechSynthesisUtterance(text);
  speech.lang = "pt-BR";
  window.speechSynthesis.speak(speech);
}

export function Recognize() {
  const notify = useNotify();
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const camera = useCamera(video);

  const [model, setModel] = useState<ModelPackage | null>(null);
  const [modelKey, setModelKey] = useState(0);
  const [modelError, setModelError] = useState(false);
  const [word, setWord] = useState<Spoken | null>(null);
  const [phrase, setPhrase] = useState<Spoken[]>([]);
  const [progress, setProgress] = useState(0);
  const [hands, setHands] = useState(false);
  const [framing, setFraming] = useState<Framing>({ state: "unknown", missing: null });
  const [speak, setSpeak] = useState(false);
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState<string | null>(null);

  const speakRef = useRef(false);
  const nextId = useRef(1);
  const tracker = useRef(new FramingTracker());
  const shown = useRef({ progress: 0, hands: false });

  useEffect(() => {
    let active = true;
    setModel(null);
    setModelError(false);
    loadModelPackage()
      .then((loaded) => active && setModel(loaded))
      .catch(() => active && setModelError(true));
    return () => {
      active = false;
    };
  }, [modelKey]);

  const recognizer = useMemo(() => {
    if (!model) return null;
    const { meta } = model;
    return new Recognizer(featuresFor(meta.feature_version), model.predict, {
      frames: meta.frames,
      threshold: meta.threshold,
      stability: meta.stability,
      inferEvery: meta.infer_every,
      handLostGrace: meta.hand_lost_grace,
    });
  }, [model]);

  // The state of the camera and of the model goes to the top of the screen, not over the preview.
  useEffect(() => {
    if (camera.state === "starting") return notify("Ligando a câmera…", { stay: true });
    if (camera.state === "error") notify(messageFor("camera_error"));
  }, [camera.state, notify]);
  useEffect(() => {
    if (!model && !modelError) return notify("Carregando o modelo…", { stay: true });
    if (modelError) notify(messageFor("model_error"));
  }, [model, modelError, notify]);

  // When the person is not in the picture for a while, say what is missing.
  useEffect(() => {
    if (framing.state !== "bad") return;
    let dismiss: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      dismiss = notify(messageFor(`framing_${framing.missing ?? "shoulders"}`), { stay: true });
    }, HINT_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      dismiss?.();
    };
  }, [framing, notify]);

  /** A sign was recognized: show it, add it to the phrase, and say it if the sound is on. */
  const announce = useCallback((text: string) => {
    const item = { id: nextId.current++, text, at: Date.now() };
    setWord(item);
    setPhrase((list) => [...list, item].slice(-PHRASE_MAX));
    if (speakRef.current) say(text);
  }, []);

  /** Change the bar and the "hands" state only when they change enough, so the screen does not draw at every frame. */
  const show = useCallback((value: number, handsNow: boolean) => {
    const last = shown.current;
    if (Math.abs(value - last.progress) >= 0.05 || value === 0 || value === 1) {
      if (value !== last.progress) setProgress(value);
      last.progress = value;
    }
    if (handsNow !== last.hands) {
      last.hands = handsNow;
      setHands(handsNow);
    }
  }, []);

  // The detectors, the outline, and the recognizer.
  useEffect(() => {
    const marks = camera.landmarkers.current;
    const element = video.current;
    const canvas = overlay.current;
    if (camera.state !== "ready" || !marks || !element || !canvas || !recognizer || !model) return;
    tracker.current.reset();
    setFraming(tracker.current.state);
    recognizer.reset();
    const stop = watchFrames(element, marks, (frame) => {
      const change = tracker.current.update(missingInFrame(frame.pose?.image), frame.t);
      if (change) setFraming(change);
      const state = tracker.current.state.state;
      drawLive(canvas, element, frame, state === "unknown" ? "neutral" : state);
      // Only a person in the picture is read, because the features need the shoulders.
      if (state !== "ok") {
        recognizer.reset();
        show(0, false);
        return;
      }
      const step = recognizer.push(frame);
      show(step.progress, step.state === "detecting");
      if (step.word !== null) announce(model.classes[step.word].name);
    });
    return () => {
      stop();
      drawLive(canvas, element, null);
    };
  }, [camera.state, camera.landmarkers, recognizer, model, announce, show]);

  // The big word goes away after a few seconds, and so does each word of the phrase.
  useEffect(() => {
    if (!word) return;
    const timer = window.setTimeout(() => setWord((now) => (now?.id === word.id ? null : now)), WORD_MS);
    return () => window.clearTimeout(timer);
  }, [word]);
  useEffect(() => {
    if (phrase.length === 0) return;
    const wait = Math.max(0, phrase[0].at + PHRASE_MS - Date.now());
    const timer = window.setTimeout(() => setPhrase((list) => list.filter((item) => Date.now() - item.at < PHRASE_MS)), wait + 20);
    return () => window.clearTimeout(timer);
  }, [phrase]);

  function toggleSpeak() {
    const next = !speak;
    setSpeak(next);
    speakRef.current = next;
    // The first sound needs a touch of the person, so the toggle starts the voice.
    if (next) say("");
  }

  const canSpeak = "speechSynthesis" in window;
  const problem =
    camera.state === "error"
      ? { kind: "camera", title: "Câmera indisponível", text: messageFor("camera_error"), run: camera.retry }
      : modelError
        ? { kind: "model", title: "Modelo indisponível", text: messageFor("model_error"), run: () => setModelKey((k) => k + 1) }
        : null;
  useEffect(() => setClosed(null), [problem?.kind]);

  const status = camera.state !== "ready" || !model ? "" : framing.state === "bad" ? "" : !hands ? "Mostre as mãos" : word ? "" : "Reconhecendo…";
  return (
    <main className="screen recognize">
      <section className="panel panel--mirror" aria-label="Sua câmera">
        <video ref={video} muted playsInline />
        <canvas ref={overlay} />
        <div className="panel__fade" />
      </section>

      <div className="known">
        <button type="button" className="known__button" aria-expanded={open} onClick={() => setOpen((now) => !now)}>
          Ver sinais conhecidos
          <IconChevronDown aria-hidden="true" className={open ? "known__arrow known__arrow--open" : "known__arrow"} />
        </button>
        {open && (
          <div className="known__list">
            {model ? (
              <>
                <p className="known__title">{model.meta.name}</p>
                <ul>{model.classes.map((sign) => <li key={sign.slug}>{sign.name}</li>)}</ul>
              </>
            ) : (
              <p className="known__title">Carregando…</p>
            )}
          </div>
        )}
      </div>

      <p className="recognize__status" role="status">{status}</p>
      {word && <p key={word.id} className="recognize__word">{word.text}</p>}
      <div className="recognize__bar" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></div>
      <ul className="recognize__phrase" aria-label="Últimos sinais">
        {phrase.map((item) => <li key={item.id}>{item.text}</li>)}
      </ul>
      <div className="row">
        <RoundButton
          size="lg"
          active={speak}
          label={speak ? "Parar de falar os sinais" : "Falar os sinais em voz alta"}
          disabled={!canSpeak}
          onClick={toggleSpeak}
        >
          {speak ? <IconVolume aria-hidden="true" /> : <IconVolumeOff aria-hidden="true" />}
        </RoundButton>
      </div>

      {problem && closed !== problem.kind && (
        <Sheet title={problem.title} onClose={() => setClosed(problem.kind)}>
          <p>{problem.text}</p>
          <button type="button" className="button button--primary" onClick={problem.run}>Tentar de novo</button>
          <button type="button" className="button button--quiet" onClick={() => setClosed(problem.kind)}>Fechar</button>
        </Sheet>
      )}
    </main>
  );
}
