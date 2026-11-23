import { useEffect, useRef, useState } from "react";
import { assignHands } from "../../shared/hands";
import { loadLandmarkers, startCamera, stopCamera, type Landmarkers } from "../capture/recorder";
import { packFrames, type RawFrame } from "../capture/pack";
import { frameFeatures } from "../recognize/demo/oldFeatures";
import { loadDemoModel, predict, type DemoModel } from "../recognize/demo/model";

// TEMPORARY DEMO: it uses an old model that is not in the repository (public/demo-model/).
// The model of the project replaces this page when the training has data.
const WINDOW = 20;

interface Guess {
  name: string;
  probability: number;
}

export function Recognize() {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "running" | "missing" | "error">("idle");
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const stop = useRef<() => void>(() => {});

  useEffect(() => () => stop.current(), []);

  async function start() {
    setState("loading");
    let model: DemoModel;
    try {
      model = await loadDemoModel();
    } catch {
      setState("missing");
      return;
    }
    let stream: MediaStream | null = null;
    try {
      const landmarkers: Landmarkers = await loadLandmarkers();
      stream = await startCamera(video.current!);
      let running = true;
      stop.current = () => {
        running = false;
        stopCamera(stream);
      };
      setState("running");
      const frames: RawFrame[] = [];
      let lastVideoTime = -1;
      let lastT = -1;
      const step = () => {
        if (!running) return;
        const el = video.current!;
        const now = performance.now();
        if (el.currentTime !== lastVideoTime && now > lastT) {
          lastVideoTime = el.currentTime;
          lastT = now;
          const hands = landmarkers.hand.detectForVideo(el, now);
          const pose = landmarkers.pose.detectForVideo(el, now);
          frames.push({
            t: now,
            pose: pose.landmarks[0] ? { image: pose.landmarks[0], world: pose.worldLandmarks[0] } : undefined,
            hands: hands.landmarks.map((image, i) => ({
              image, world: hands.worldLandmarks[i],
              label: hands.handedness[i]?.[0]?.categoryName ?? "", score: hands.handedness[i]?.[0]?.score ?? 0,
            })),
          });
          if (frames.length > WINDOW) frames.shift();
          if (frames.length === WINDOW) {
            const capture = assignHands(packFrames(frames));
            const probabilities = predict(model, Array.from({ length: WINDOW }, (_, i) => frameFeatures(capture, i)));
            setGuesses(
              Array.from(probabilities, (probability, i) => ({ name: model.classes[i], probability }))
                .sort((a, b) => b.probability - a.probability)
                .slice(0, 3),
            );
          }
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    } catch {
      stopCamera(stream);
      setState("error");
    }
  }

  return (
    <main className="page">
      <h1>Reconhecer</h1>
      <p className="note">
        Demonstração temporária com um modelo antigo de 10 sinais. O modelo do projeto ainda não foi treinado.
      </p>
      <video ref={video} playsInline muted style={{ width: "100%", maxWidth: 480, transform: "scaleX(-1)" }} />
      {state === "idle" && <button onClick={start}>Ligar a câmera</button>}
      {state === "loading" && <p>Carregando…</p>}
      {state === "missing" && <p className="note">Modelo de demonstração não encontrado neste ambiente.</p>}
      {state === "error" && <p className="note">Não foi possível usar a câmera ou carregar os detectores.</p>}
      {state === "running" && (
        <ol>
          {guesses.length === 0 && <li>Aguardando quadros…</li>}
          {guesses.map((g) => (
            <li key={g.name}>{g.name}: {Math.round(g.probability * 100)}%</li>
          ))}
        </ol>
      )}
    </main>
  );
}
