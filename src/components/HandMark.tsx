// The 21 hand landmarks in the "L" handshape, drawn as the capture overlay draws them.
const POINTS: [number, number][] = [
  [100, 220],
  [78, 200], [58, 178], [38, 162], [18, 150],
  [84, 140], [82, 100], [81, 70], [80, 42],
  [104, 136], [108, 112], [106, 132], [103, 150],
  [122, 142], [127, 120], [124, 138], [120, 154],
  [138, 154], [144, 134], [141, 148], [137, 162],
];

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const TIPS = new Set([4, 8]);

export function HandMark({ className }: { className?: string }) {
  return (
    <svg className={`hand-mark ${className ?? ""}`} viewBox="0 0 200 240" role="img" aria-label="Mão fazendo a letra L em Libras, desenhada com os pontos de detecção">
      <g className="hand-mark__bones">
        {BONES.map(([a, b], i) => (
          <line
            key={i}
            x1={POINTS[a][0]} y1={POINTS[a][1]} x2={POINTS[b][0]} y2={POINTS[b][1]}
            pathLength={1}
            style={{ animationDelay: `${i * 35}ms` }}
          />
        ))}
      </g>
      <g className="hand-mark__points">
        {POINTS.map(([x, y], i) => (
          <circle
            key={i}
            cx={x} cy={y} r={TIPS.has(i) ? 7 : 4.5}
            className={TIPS.has(i) ? "is-tip" : undefined}
            style={{ animationDelay: `${300 + i * 35}ms` }}
          />
        ))}
      </g>
    </svg>
  );
}
