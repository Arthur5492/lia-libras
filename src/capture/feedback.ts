// Messages for the person when a recording is not good enough. The numbers come from the same
// rules as the server (shared/metrics.ts), so the page and the API never disagree.
import { MIN_FRAMES } from "../../shared/capture";
import { ANY_HAND_RATE_MIN, POSE_RATE_MIN, type Metrics } from "../../shared/metrics";

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** One message for each failure, with the measured value, the minimum and what to do. */
export function describeProblems(flags: string[], metrics?: Partial<Metrics>): string[] {
  const problems: string[] = [];
  for (const flag of flags) {
    if (flag === "low_pose_rate") {
      const seen = metrics?.pose_rate === undefined ? "" : `O corpo apareceu em ${percent(metrics.pose_rate)} do tempo (mínimo ${percent(POSE_RATE_MIN)}). `;
      problems.push(`${seen}Afaste a câmera para aparecer da cintura para cima, com boa luz.`);
    } else if (flag === "low_any_hand_rate") {
      const seen = metrics?.any_hand_rate === undefined ? "" : `As mãos apareceram em ${percent(metrics.any_hand_rate)} do tempo (mínimo ${percent(ANY_HAND_RATE_MIN)}). `;
      problems.push(`${seen}Mantenha as mãos à vista da câmera durante toda a gravação.`);
    }
  }
  return problems;
}

/** The device processed too few frames. This happens when the detector is slow. */
export function describeFewFrames(frameCount: number, seconds: number): string {
  return (
    `O aparelho processou só ${frameCount} quadros em ${seconds.toFixed(1)} s (mínimo ${MIN_FRAMES}). ` +
    "Feche outros aplicativos, aproxime-se de um local mais iluminado e tente de novo."
  );
}
