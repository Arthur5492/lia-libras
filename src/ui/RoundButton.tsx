import type { ReactNode } from "react";

interface Props {
  /** `lg` is the base size. `sm` is 75% of it. The sizes come from `--b` in ui.css. */
  size: "lg" | "sm";
  /** Name for screen readers. The button has only an icon. */
  label: string;
  onClick(): void;
  disabled?: boolean;
  /** The icon is bigger, for icons that have a small drawing, such as the "i". */
  bigIcon?: boolean;
  /** Color of the icon. */
  tone?: "red";
  /** A button that is on or off. When it is on, it is green. */
  active?: boolean;
  children: ReactNode;
}

/** A round button with an outline icon. The icon is the child. */
export function RoundButton({ size, label, onClick, disabled, bigIcon, tone, active, children }: Props) {
  const classes = ["rbtn", `rbtn--${size}`, bigIcon ? "rbtn--big-icon" : "", tone ? `rbtn--${tone}` : "", active ? "rbtn--on" : ""];
  return (
    <button type="button" className={classes.filter(Boolean).join(" ")} aria-label={label} aria-pressed={active} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
