import { useEffect, useState } from "react";
import { api, errorMessage, type Recording, type ReviewChoice, type Sign } from "../api";
import { canReview, useProfile } from "../auth";
import { Player } from "../components/Player";
import { messageFor } from "../messages";
import type { ReplayData } from "../replay/draw";

const STATUSES: [string, string][] = [
  ["unreviewed", "Não revisadas"],
  ["trusted_unreviewed", "Não revisadas (de pessoas confiáveis)"],
  ["accepted", "Aceitas"],
  ["rejected", "Rejeitadas"],
];

function Queue() {
  const [status, setStatus] = useState("unreviewed");
  const [signId, setSignId] = useState("");
  const [signs, setSigns] = useState<Sign[]>([]);
  const [items, setItems] = useState<Recording[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<{ item: Recording; replay: ReplayData } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.signs().then((r) => setSigns(r.signs)).catch(() => {});
  }, []);

  // Load the first page again when a filter changes.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setCurrent(null);
    setMessage("");
    api.reviewList({ status, sign_id: signId || undefined })
      .then((r) => {
        if (!active) return;
        setItems(r.items);
        setCursor(r.next_cursor);
      })
      .catch((e) => active && setMessage(errorMessage(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [status, signId]);

  async function more() {
    if (!cursor) return;
    try {
      const r = await api.reviewList({ status, sign_id: signId || undefined, cursor });
      setItems((list) => [...list, ...r.items]);
      setCursor(r.next_cursor);
    } catch (e) {
      setMessage(errorMessage(e));
    }
  }

  async function open(item: Recording) {
    setBusy(true);
    setMessage("");
    try {
      setCurrent({ item, replay: await api.replay(item.id) });
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function decide(choice: ReviewChoice) {
    if (!current) return;
    setBusy(true);
    setMessage("");
    const { item } = current;
    try {
      await api.review(item.id, choice);
      // The recording leaves this list, because it no longer has this status. Then open the next one.
      const index = items.findIndex((i) => i.id === item.id);
      const rest = items.filter((i) => i.id !== item.id);
      setItems(rest);
      const following = rest.find((_, i) => i >= index) ?? rest[rest.length - 1];
      setCurrent(null);
      if (following && !following.is_own) await open(following);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const sign = current ? signs.find((s) => s.id === current.item.sign_id) : undefined;
  const own = current?.item.is_own;

  return (
    <main className="page">
      <h1>Analisar</h1>
      <div className="form">
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sign">Sinal</label>
          <select id="sign" value={signId} onChange={(e) => setSignId(e.target.value)}>
            <option value="">Todos</option>
            {signs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {message && <p className="form-error" role="alert">{message}</p>}
      {loading && <p className="muted">Carregando…</p>}
      {!loading && items.length === 0 && <p className="muted">Nenhuma gravação neste filtro.</p>}

      {current && (
        <section>
          <h2>{sign?.name ?? current.item.sign_id} #{current.item.video_idx}</h2>
          <p className="muted">
            Nível de quem gravou: {current.item.user_trust_level}
            {current.item.validation_flags.length > 0 && ` · avisos: ${current.item.validation_flags.join(", ")}`}
          </p>
          <Player replay={current.replay} />
          {sign && <video src={sign.video_url} controls loop muted playsInline width={320} />}
          {own && <p className="form-error">{messageFor("cannot_review_own")}</p>}
          <button className="button button--primary" disabled={busy || own} onClick={() => decide("accepted")}>Aceitar</button>
          <button className="button button--quiet" disabled={busy || own} onClick={() => decide("rejected")}>Rejeitar</button>
          {status !== "unreviewed" && status !== "trusted_unreviewed" && (
            <button className="button button--quiet" disabled={busy || own} onClick={() => decide("pending")}>
              Voltar para não revisada
            </button>
          )}
        </section>
      )}

      <ul className="sign-list">
        {items.map((item) => (
          <li key={item.id} className="sign-row">
            <span>
              {signs.find((s) => s.id === item.sign_id)?.name ?? item.sign_id} #{item.video_idx}
              <span className="muted sign-row__meta">
                {item.user_trust_level}{item.is_own ? " · sua" : ""}
              </span>
            </span>
            <button className="link-button" disabled={busy} onClick={() => open(item)}>Ver</button>
          </li>
        ))}
      </ul>
      {cursor && <button className="button button--quiet" onClick={more}>Carregar mais</button>}
    </main>
  );
}

export function Review() {
  const profile = useProfile();

  if (!canReview(profile)) {
    return (
      <main className="page">
        <h1>Analisar</h1>
        <p>
          A análise confere se cada gravação mostra o sinal certo. Ela é feita por pessoas com nível de confiança
          mais alto, definido pela equipe do projeto.
        </p>
        <p className="note">Seu nível atual é regular. Suas gravações continuam valendo normalmente.</p>
      </main>
    );
  }
  return <Queue />;
}
