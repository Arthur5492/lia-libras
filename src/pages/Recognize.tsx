import { IconChevronDown, IconSettings, IconVolume, IconVolumeOff } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { missingInFrame } from "../../shared/framing";
import { FramingTracker, type Framing } from "../capture/framingTracker";
import { drawLive } from "../capture/overlay";
import { watchFrames } from "../capture/recorder";
import { useCamera } from "../capture/useCamera";
import { messageFor } from "../messages";
import { useNotify } from "../notifications";
import { featuresFor } from "../recognize/features";
import { loadModelPackage, shownName, type ModelPackage } from "../recognize/model";
import { Recognizer } from "../recognize/recognizer";
import { clampTuning, clearTuning, defaultTuning, loadTuning, saveTuning, TUNING_LIMITS, type Tuning } from "../recognize/tuning";
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

/** The controls of the settings. `show` makes the text of the value. */
const SETTINGS: { key: keyof Tuning; label: string; help: string; show: (value: number) => string }[] = [
  { key: "infer_every", label: "Rodar o modelo a cada", help: "Menos quadros dá resposta mais rápida e gasta mais bateria.", show: (v) => (v === 1 ? "1 quadro" : `${v} quadros`) },
  { key: "stability", label: "Previsões iguais seguidas", help: "Menos dá resposta mais rápida e erra mais.", show: (v) => String(v) },
  { key: "threshold", label: "Confiança mínima", help: "Menos aceita mais cedo e erra mais.", show: (v) => `${Math.round(v * 100)}%` },
  { key: "hand_lost_grace", label: "Quadros sem mão antes de recomeçar", help: "Mais deixa abaixar a mão no fim do sinal.", show: (v) => String(v) },
];

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
  // The settings of an admin: the numbers of the recognizer, and two numbers that show their effect.
  const { session } = useAuth();
  const admin = session.state === "ready" && session.profile.role === "admin";
  const [tuning, setTuning] = useState<Tuning | null>(null);
  const [settings, setSettings] = useState(false);
  const [fps, setFps] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);

  const speakRef = useRef(false);
  const nextId = useRef(1);
  const tracker = useRef(new FramingTracker());
  const shown = useRef({ progress: 0, hands: false });
  const frameTimes = useRef<number[]>([]);
  const handsSince = useRef<number | null>(null);

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

  // The numbers of the recognizer: the ones of the model, and the ones saved on this device.
  useEffect(() => {
    if (model) setTuning(loadTuning(model.meta));
  }, [model]);
  useEffect(() => {
    if (recognizer && tuning) recognizer.setOptions({
      inferEvery: tuning.infer_every,
      stability: tuning.stability,
      threshold: tuning.threshold,
      handLostGrace: tuning.hand_lost_grace,
    });
  }, [recognizer, tuning]);

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
    frameTimes.current = [];
    handsSince.current = null;
    const stop = watchFrames(element, marks, (frame) => {
      const times = frameTimes.current;
      times.push(frame.t);
      if (times.length > 30) times.shift();
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
      // The time from the hands in the picture, or from the last sign, to the next sign.
      if (step.state === "idle") handsSince.current = null;
      else handsSince.current ??= frame.t;
      if (step.word !== null) {
        if (handsSince.current !== null) setLatency(Math.round(frame.t - handsSince.current));
        handsSince.current = frame.t;
        announce(shownName(model.classes[step.word]));
      }
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

  // While the settings are open, show the frames each second.
  useEffect(() => {
    if (!settings) return;
    const timer = window.setInterval(() => {
      const times = frameTimes.current;
      setFps(times.length > 1 ? Math.round(((times.length - 1) * 1000) / (times[times.length - 1] - times[0])) : 0);
    }, 500);
    return () => window.clearInterval(timer);
  }, [settings]);

  function change(key: keyof Tuning, value: number) {
    if (!model || !tuning) return;
    const next = { ...tuning, [key]: clampTuning(key, value) };
    setTuning(next);
    saveTuning(model.meta, next);
  }

  function restore() {
    if (!model) return;
    clearTuning(model.meta);
    setTuning(defaultTuning(model.meta));
  }

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

      {admin && (
        <button type="button" className="gear" aria-label="Ajustes do reconhecimento" onClick={() => setSettings(true)}>
          <IconSettings aria-hidden="true" />
        </button>
      )}

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

      {settings && model && tuning && (
        <Sheet title="Ajustes do reconhecimento" onClose={() => setSettings(false)}>
          <p className="muted">Valem na hora e ficam guardados só neste aparelho.</p>
          <div className="tuning">
            {SETTINGS.map(({ key, label, help, show: format }) => (
              <div key={key} className="tuning__row">
                <label htmlFor={`tuning-${key}`}>{label}: <strong>{format(tuning[key])}</strong></label>
                <input
                  id={`tuning-${key}`}
                  type="range"
                  min={TUNING_LIMITS[key].min}
                  max={TUNING_LIMITS[key].max}
                  step={TUNING_LIMITS[key].step}
                  value={tuning[key]}
                  onChange={(event) => change(key, Number(event.target.value))}
                />
                <p className="field__help">{help}</p>
              </div>
            ))}
          </div>
          <p className="tuning__live">
            Quadros por segundo: <strong>{fps || "…"}</strong>. Última confirmação:{" "}
            <strong>{latency === null ? "ainda nenhuma" : `${(latency / 1000).toFixed(1)} s`}</strong>.
          </p>
          <p className="field__help">A janela do modelo é de {model.meta.frames} quadros e não muda sem treinar de novo.</p>
          <button type="button" className="button button--quiet" onClick={restore}>Voltar ao padrão do modelo</button>
          <button type="button" className="button button--primary" onClick={() => setSettings(false)}>Fechar</button>
        </Sheet>
      )}

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
