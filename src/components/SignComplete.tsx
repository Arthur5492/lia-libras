import { IconHandFinger } from "@tabler/icons-react";
import { useMemo, type CSSProperties } from "react";

const COLORS = ["#ff6b6b", "#ffd93d", "#6bff95", "#4dd2ff", "#c77dff", "#ff9f43"];
const PIECES = 36;

/** Numbers that look random but are the same each time, so the confetti does not jump when the screen draws again. */
function makePieces() {
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: PIECES }, (_, i) => ({
    // Half of the pieces fall on the left edge and half on the right edge, so the center stays free for the text.
    left: i % 2 === 0 ? next() * 22 : 78 + next() * 22,
    delay: next() * 2.4,
    duration: 2.6 + next() * 1.8,
    size: 6 + next() * 8,
    color: COLORS[i % COLORS.length],
    drift: (next() - 0.5) * 80,
    spin: 360 + next() * 720,
  }));
}

/**
 * Shown when all the recordings of a sign are done: confetti around the screen, the word "Concluído!", and a hand that
 * moves from the right to the left with a trail, to show the gesture that goes to the next sign. A tap does the same.
 */
export function SignComplete({ onNext }: { onNext(): void }) {
  const pieces = useMemo(makePieces, []);
  return (
    <div className="dim complete" role="button" aria-label="Próximo sinal" onClick={onNext}>
      {pieces.map((piece, i) => (
        <span
          key={i}
          className="confetti"
          style={{
            left: `${piece.left}%`,
            width: piece.size,
            height: piece.size * 0.45,
            background: piece.color,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            "--drift": `${piece.drift}px`,
            "--spin": `${piece.spin}deg`,
          } as CSSProperties}
        />
      ))}
      <p className="complete__title">Concluído!</p>
      <div className="swipe" aria-hidden="true">
        <div className="swipe__trail" />
        <IconHandFinger className="swipe__hand" />
      </div>
      <p className="complete__text">Passe a mão da direita para a esquerda para ir ao próximo sinal.</p>
      <p className="complete__sub">Ou toque na tela.</p>
    </div>
  );
}
