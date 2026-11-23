import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  onClose(): void;
  children: ReactNode;
}

/** A panel that comes from the bottom. A tap outside it, or the Escape key, closes it. */
export function Sheet({ title, onClose, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet" onClick={onClose}>
      <div
        ref={panel}
        className="sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="sheet__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
