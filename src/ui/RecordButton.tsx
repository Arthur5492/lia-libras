interface Props {
  /** From 0 to 1. The ring fills with red while the person holds the gesture. */
  progress: number;
  /** The center is a square while the recording runs. */
  recording: boolean;
  disabled?: boolean;
  onClick(): void;
}

/**
 * The record button. It sits on the top edge of the tab bar, with 70% of the circle inside the bar.
 * All the parts are in one drawing, so they always have the same center.
 */
export function RecordButton({ progress, recording, disabled, onClick }: Props) {
  return (
    <div className="dock">
      <button type="button" className="record" aria-label="Gravar" onClick={onClick} disabled={disabled}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="50" style={{ fill: "var(--bg)" }} />
          <circle cx="50" cy="50" r="46.4" fill="none" strokeWidth="7.2" style={{ stroke: "var(--text)" }} />
          <circle
            cx="50" cy="50" r="46.4" fill="none" strokeWidth="7.2" pathLength="100"
            strokeDasharray="100" strokeDashoffset={100 * (1 - progress)} transform="rotate(-90 50 50)"
            style={{ stroke: "var(--red)" }}
          />
          {recording ? (
            <rect x="32" y="32" width="36" height="36" rx="7" style={{ fill: "var(--red)" }} />
          ) : (
            <circle cx="50" cy="50" r="36" style={{ fill: "var(--text-strong)" }} />
          )}
        </svg>
      </button>
    </div>
  );
}
