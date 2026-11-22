import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage, type Recording, type Sign } from "../api";
import { useAuth } from "../auth";
import { Player } from "../components/Player";
import type { ReplayData } from "../replay/draw";

export function MyRecordings() {
  const { setProfile } = useAuth();
  const [items, setItems] = useState<Recording[] | null>(null);
  const [signs, setSigns] = useState<Record<string, Sign>>({});
  const [open, setOpen] = useState<{ id: string; replay: ReplayData } | null>(null);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api.myRecordings().then((r) => setItems(r.items)).catch((e) => setMessage(errorMessage(e)));
    api.signs().then((r) => setSigns(Object.fromEntries(r.signs.map((s) => [s.id, s])))).catch(() => {});
  }, []);

  async function view(id: string) {
    setBusyId(id);
    setMessage("");
    try {
      setOpen({ id, replay: await api.replay(id) });
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Apagar esta gravação?")) return;
    setBusyId(id);
    setMessage("");
    try {
      await api.deleteRecording(id);
      setItems((current) => current?.filter((item) => item.id !== id) ?? null);
      if (open?.id === id) setOpen(null);
      setProfile(await api.me());
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!items) return <main className="page"><p className="muted">{message || "Carregando…"}</p></main>;

  return (
    <main className="page">
      <p><Link to="/perfil">Voltar ao perfil</Link></p>
      <h1>Minhas gravações</h1>
      {message && <p className="form-error" role="alert">{message}</p>}
      {items.length === 0 && <p className="muted">Você ainda não gravou nada.</p>}
      <ul className="sign-list">
        {items.map((item) => (
          <li key={item.id} className="sign-row">
            <span>
              {signs[item.sign_id]?.name ?? item.sign_id} #{item.video_idx}
              <span className="muted sign-row__meta">{item.status} · {item.frame_count} quadros</span>
            </span>
            <span className="sign-row__actions">
              <button className="link-button" disabled={busyId === item.id} onClick={() => view(item.id)}>Ver</button>
              <button className="link-button" disabled={busyId === item.id} onClick={() => remove(item.id)}>Apagar</button>
            </span>
          </li>
        ))}
      </ul>
      {open && <Player replay={open.replay} />}
    </main>
  );
}
