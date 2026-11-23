import { IconBell } from "@tabler/icons-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Notification } from "./api";
import { notificationText } from "./messages";
import { Sheet } from "./ui/Sheet";

const POLL_MS = 60_000;
const BANNER_MS = 4_000;
/** At the start, show a banner for this number of unread notifications at most. */
const FIRST_BANNERS = 2;

interface Banner {
  id: number;
  title: string;
  /** The banner stays until its owner dismisses it. */
  stay: boolean;
}

interface Value {
  /**
   * Show a message at the top. It goes away by itself, unless `stay` is true.
   * The function that it returns removes the message, for a message with `stay`.
   */
  notify(title: string, options?: { stay?: boolean }): () => void;
}

const NotificationsContext = createContext<Value | null>(null);

/** For a page that needs to show a short message at the top. */
export function useNotify(): Value["notify"] {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error("useNotify must be inside NotificationsProvider");
  return value.notify;
}

/**
 * Notifications of the server (a recording that a reviewer accepted or rejected), and the messages that the pages make.
 * The bell keeps the list and the number of unread ones. The banner at the top shows one message at a time and goes away.
 * Without an `account` (a person who did not sign in) there is no bell and no check of the server: only the banner.
 */
export function NotificationsProvider({ children, account = true }: { children: ReactNode; account?: boolean }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [open, setOpen] = useState(false);
  const queue = useRef<Banner[]>([]);
  const nextId = useRef(1);
  const seen = useRef<Set<string> | null>(null);
  const timer = useRef<number>(0);

  const current = useRef<Banner | null>(null);

  const showNext = useCallback(() => {
    window.clearTimeout(timer.current);
    const next = queue.current.shift() ?? null;
    current.current = next;
    setBanner(next);
    if (next && !next.stay) timer.current = window.setTimeout(showNext, BANNER_MS);
  }, []);

  const notify = useCallback((title: string, options?: { stay?: boolean }) => {
    const item: Banner = { id: nextId.current++, title, stay: Boolean(options?.stay) };
    queue.current.push(item);
    if (!current.current) showNext();
    return () => {
      queue.current = queue.current.filter((other) => other.id !== item.id);
      if (current.current?.id === item.id) showNext();
    };
  }, [showNext]);

  const refresh = useCallback(async () => {
    try {
      const page = await api.notifications();
      setItems(page.items);
      setUnread(page.unread_count);
      const fresh = page.items.filter((item) => !item.read && !seen.current?.has(item.id));
      const shown = seen.current === null ? fresh.slice(0, FIRST_BANNERS) : fresh;
      seen.current = new Set(page.items.map((item) => item.id));
      for (const item of shown.reverse()) notify(notificationText(item).title);
    } catch {
      // A failure here is not important: the next check tries again.
    }
  }, [notify]);

  useEffect(() => {
    if (!account) return;
    void refresh();
    const id = window.setInterval(refresh, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(timer.current);
    };
  }, [refresh, account]);

  async function openList() {
    setOpen(true);
    const ids = items.filter((item) => !item.read).map((item) => item.id);
    if (ids.length === 0) return;
    setUnread(0);
    try {
      await api.markNotificationsRead(ids);
    } catch {
      void refresh();
    }
  }

  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <NotificationsContext.Provider value={value}>
      {children}
      {account && <button type="button" className="bell" aria-label={unread > 0 ? `Notificações, ${unread} não lidas` : "Notificações"} onClick={openList}>
        <IconBell aria-hidden="true" />
        {unread > 0 && <span className="bell__badge" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>}
      <div className={`banner${banner ? " banner--on" : ""}`} role="status" aria-live="polite">
        {banner && (
          <>
            <IconBell aria-hidden="true" />
            <span>{banner.title}</span>
          </>
        )}
      </div>
      {open && (
        <Sheet title="Notificações" onClose={() => setOpen(false)}>
          {items.length === 0 ? (
            <p className="muted">Nenhuma notificação por enquanto.</p>
          ) : (
            <ul className="notes">
              {items.map((item) => {
                const text = notificationText(item);
                return (
                  <li key={item.id}>
                    <strong>{text.title}</strong>
                    {text.detail && <span className="muted">{text.detail}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Sheet>
      )}
    </NotificationsContext.Provider>
  );
}
