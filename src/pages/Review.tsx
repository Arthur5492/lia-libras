import { IconChevronsRight, IconHeart, IconInfoSmall, IconRotate, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { api, errorMessage, type RejectionReason, type Recording, type Sign } from "../api";
import { canReview, useProfile } from "../auth";
import { Player } from "../components/Player";
import { messageFor, REJECTION_REASON_TEXT } from "../messages";
import { useNotify } from "../notifications";
import type { ReplayData } from "../replay/draw";
import { RoundButton } from "../ui/RoundButton";
import { Sheet } from "../ui/Sheet";
import { MyRecordings } from "./MyRecordings";

/** The review list has one status at a time. The reviewer sees the two that wait for review. */
const STATUSES = ["unreviewed", "trusted_unreviewed"];
/** The screen keeps this number of recordings ready, so the next card is there when the person decides. */
const BUFFER = 4;
/** A drag farther than this (in pixels) is a decision. */
const SWIPE_PX = 90;

type Action = "accepted" | "rejected" | "skipped";
interface Decision {
  item: Recording;
  action: Action;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function Swipe() {
  const notify = useNotify();
  const [queue, setQueue] = useState<Recording[]>([]);
  const [history, setHistory] = useState<Decision[]>([]);
  const [signs, setSigns] = useState<Record<string, Sign>>({});
  const [replays, setReplays] = useState<Record<string, ReplayData | "loading" | "error">>({});
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  const [info, setInfo] = useState(false);
  const [emptyClosed, setEmptyClosed] = useState(false);

  const card = useRef<HTMLDivElement>(null);
  const yes = useRef<HTMLDivElement>(null);
  const no = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const locked = useRef(false);
  const loader = useRef({ statuses: [...STATUSES], cursors: {} as Record<string, string | null>, busy: false });
  const known = useRef(new Set<string>());
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const current = queue[0];
  const sign = current ? signs[current.sign_id] : undefined;
  const replay = current ? replays[current.id] : undefined;

  useEffect(() => {
    api.signs().then((r) => setSigns(Object.fromEntries(r.signs.map((s) => [s.id, s])))).catch(() => {});
  }, []);

  // The state of the screen goes to the top, not over the videos.
  useEffect(() => {
    if (loading) return notify("Carregando…", { stay: true });
  }, [loading, notify]);
  useEffect(() => {
    if (replays[queue[0]?.id ?? ""] === "error") notify(messageFor("recording_file_missing"));
    // Only the replay of the card on top matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue[0]?.id, replays[queue[0]?.id ?? ""]]);

  /** Load pages until the buffer is full or there is nothing more. Own recordings are left out: nobody reviews their own. */
  const fill = useCallback(async () => {
    const state = loader.current;
    if (state.busy) return;
    state.busy = true;
    try {
      let added = 0;
      while (queueRef.current.length + added < BUFFER && state.statuses.length > 0) {
        const status = state.statuses[0];
        const page = await api.reviewList({ status, cursor: state.cursors[status] ?? undefined });
        state.cursors[status] = page.next_cursor;
        if (!page.next_cursor) state.statuses.shift();
        const fresh = page.items.filter((item) => !item.is_own && !known.current.has(item.id));
        fresh.forEach((item) => known.current.add(item.id));
        added += fresh.length;
        if (fresh.length > 0) setQueue((q) => [...q, ...fresh]);
      }
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      state.busy = false;
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (queue.length < BUFFER) void fill();
  }, [queue.length, fill]);

  // Get the replay of this card and of the next one before the person needs them.
  useEffect(() => {
    for (const item of queue.slice(0, 2)) {
      if (replays[item.id]) continue;
      setReplays((r) => ({ ...r, [item.id]: r[item.id] ?? "loading" }));
      api.replay(item.id)
        .then((data) => setReplays((r) => ({ ...r, [item.id]: data })))
        .catch(() => setReplays((r) => ({ ...r, [item.id]: "error" })));
    }
    // `replays` is read only to know what is already loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  function moveCard(dx: number) {
    if (!card.current) return;
    card.current.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    if (yes.current) yes.current.style.opacity = String(clamp(dx / SWIPE_PX));
    if (no.current) no.current.style.opacity = String(clamp(-dx / SWIPE_PX));
  }

  function resetCard(smooth: boolean) {
    if (!card.current) return;
    card.current.style.transition = smooth ? "transform 0.18s" : "none";
    card.current.style.transform = "";
    if (yes.current) yes.current.style.opacity = "0";
    if (no.current) no.current.style.opacity = "0";
  }

  function fly(direction: 1 | -1, then: () => void) {
    if (!card.current) return then();
    locked.current = true;
    card.current.style.transition = "transform 0.22s";
    card.current.style.transform = `translateX(${direction * window.innerWidth}px) rotate(${direction * 14}deg)`;
    window.setTimeout(() => {
      resetCard(false);
      locked.current = false;
      then();
    }, 230);
  }

  /** Take the card out at once and send the decision in the background. A failure puts the card back. */
  function advance(action: Action, reason?: RejectionReason) {
    const item = queueRef.current[0];
    if (!item) return;
    setQueue((q) => q.slice(1));
    setHistory((h) => [...h, { item, action }]);
    const send = action === "skipped" ? api.skipReview(item.id) : api.review(item.id, action, reason);
    send.catch((error) => {
      notify(errorMessage(error));
      setQueue((q) => [item, ...q]);
      setHistory((h) => h.filter((decision) => decision.item.id !== item.id));
    });
  }

  function accept() {
    if (!current || locked.current) return;
    fly(1, () => advance("accepted"));
  }

  /** A rejection needs a reason, so the sheet comes first. Without a choice, nothing is rejected. */
  function askReason() {
    if (!current || locked.current) return;
    resetCard(true);
    setRejecting(true);
  }

  function reject(reason: RejectionReason) {
    setRejecting(false);
    fly(-1, () => advance("rejected", reason));
  }

  function skip() {
    if (!current || locked.current) return;
    advance("skipped");
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last || locked.current) return;
    setHistory((h) => h.slice(0, -1));
    setQueue((q) => [last.item, ...q]);
    // A skip has nothing to undo on the server: the recording only comes back to this screen.
    if (last.action !== "skipped") {
      api.review(last.item.id, "pending").catch((error) => notify(errorMessage(error)));
    }
  }

  const onDown = (event: PointerEvent) => {
    if (!current || locked.current) return;
    start.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (card.current) card.current.style.transition = "none";
  };
  const onMove = (event: PointerEvent) => {
    if (start.current !== null) moveCard(event.clientX - start.current);
  };
  const onUp = (event: PointerEvent) => {
    if (start.current === null) return;
    const dx = event.clientX - start.current;
    start.current = null;
    if (dx > SWIPE_PX) accept();
    else if (dx < -SWIPE_PX) askReason();
    else resetCard(true);
  };

  // The keys help on a computer: right accepts, left rejects, down skips.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (rejecting || info) return;
      if (event.key === "ArrowRight") accept();
      else if (event.key === "ArrowLeft") askReason();
      else if (event.key === "ArrowDown") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const busy = !current;
  const empty = !loading && !current;

  /** Start again from the first page. */
  function reload() {
    loader.current = { statuses: [...STATUSES], cursors: {}, busy: false };
    known.current.clear();
    setLoading(true);
    void fill();
  }
  return (
    <main className="screen review">
      <div
        ref={card}
        className="card"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onClick={() => empty && setEmptyClosed(false)}
        onPointerCancel={() => {
          start.current = null;
          resetCard(true);
        }}
      >
        <section className="panel" aria-label="Vídeo de referência">
          {sign && <video key={sign.id} src={sign.video_url} autoPlay loop muted playsInline />}
        </section>
        <section className="panel" aria-label="Gravação a analisar">
          {replay && replay !== "error" && replay !== "loading" && <Player replay={replay} />}
          <div className="panel__fade" />
        </section>
        {current && <h1 className="sign-name">{sign?.name ?? ""}</h1>}
        <div ref={yes} className="stamp stamp--yes"><IconHeart aria-hidden="true" /></div>
        <div ref={no} className="stamp stamp--no"><IconX aria-hidden="true" /></div>
      </div>

      <div className="row">
        <RoundButton size="sm" label="Desfazer" disabled={history.length === 0} onClick={undo}><IconRotate aria-hidden="true" /></RoundButton>
        <RoundButton size="lg" label="Rejeitar" disabled={busy} onClick={askReason}><IconX aria-hidden="true" /></RoundButton>
        <RoundButton size="sm" label="Pular a gravação" disabled={busy} onClick={skip}><IconChevronsRight aria-hidden="true" /></RoundButton>
        <RoundButton size="lg" tone="red" label="Aceitar" disabled={busy} onClick={accept}><IconHeart aria-hidden="true" /></RoundButton>
        <RoundButton size="sm" bigIcon label="Informações" disabled={busy} onClick={() => setInfo(true)}><IconInfoSmall aria-hidden="true" /></RoundButton>
      </div>

      {empty && !emptyClosed && (
        <Sheet title="Nada para analisar" onClose={() => setEmptyClosed(true)}>
          <p>Não há gravações esperando análise agora.</p>
          <button type="button" className="button button--primary" onClick={reload}>Atualizar</button>
        </Sheet>
      )}
      {rejecting && (
        <Sheet title="Por que rejeitar?" onClose={() => setRejecting(false)}>
          {(Object.keys(REJECTION_REASON_TEXT) as RejectionReason[]).map((reason) => (
            <button key={reason} type="button" className="sheet__option" onClick={() => reject(reason)}>
              {REJECTION_REASON_TEXT[reason]}
            </button>
          ))}
        </Sheet>
      )}
      {info && current && (
        <Sheet title={sign?.name ?? "Gravação"} onClose={() => setInfo(false)}>
          <p>Gravação {current.video_idx} deste sinal.</p>
          {current.validation_flags.length > 0 && (
            <p className="muted">{current.validation_flags.map(messageFor).join(" ")}</p>
          )}
        </Sheet>
      )}
    </main>
  );
}

export function Review() {
  const profile = useProfile();
  // A person who cannot review sees their own recordings here.
  return canReview(profile) ? <Swipe /> : <MyRecordings />;
}
