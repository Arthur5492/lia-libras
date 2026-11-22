import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage, type Catalog, type Sign, type SignInput } from "../api";

interface EditorProps {
  catalog: Catalog;
  sign?: Sign;
  onSaved: (sign: Sign) => void;
  onCancel?: () => void;
}

/** Form for a new sign, or for the edit of an existing one. */
function SignEditor({ catalog, sign, onSaved, onCancel }: EditorProps) {
  const [name, setName] = useState(sign?.name ?? "");
  const [videoUrl, setVideoUrl] = useState(sign?.video_url ?? "");
  const [order, setOrder] = useState(String(sign?.order ?? 0));
  const [metadata, setMetadata] = useState<Record<string, boolean>>(sign?.sign_metadata ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fields = Object.entries(catalog.sign_metadata_schema);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const input: SignInput = {
      name: name.trim(),
      video_url: videoUrl.trim(),
      order: Number.parseInt(order, 10) || 0,
      sign_metadata: Object.fromEntries(fields.map(([key]) => [key, Boolean(metadata[key])])),
    };
    try {
      const saved = sign ? await api.updateSign(sign.id, input) : await api.createSign(input);
      onSaved(saved);
      if (!sign) {
        setName("");
        setVideoUrl("");
        setMetadata({});
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const id = sign?.id ?? "new";
  return (
    <form className="form editor" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor={`name-${id}`}>Nome do sinal</label>
        <input id={`name-${id}`} value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor={`url-${id}`}>Link do vídeo de referência</label>
        <input
          id={`url-${id}`}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`order-${id}`}>Posição na lista</label>
        <input id={`order-${id}`} inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} />
      </div>
      {fields.map(([key, field]) => (
        <label key={key} className="check">
          <input
            type="checkbox"
            checked={Boolean(metadata[key])}
            onChange={(e) => setMetadata({ ...metadata, [key]: e.target.checked })}
          />
          <span>{field.label}</span>
        </label>
      ))}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button--primary" disabled={busy || !name.trim() || !videoUrl.trim()}>
        {busy ? "Salvando…" : sign ? "Salvar alterações" : "Adicionar sinal"}
      </button>
      {onCancel && (
        <button type="button" className="button button--quiet" onClick={onCancel}>Cancelar</button>
      )}
    </form>
  );
}

export function AdminSigns() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api.adminSigns().then(setCatalog).catch((e) => setError(errorMessage(e)));
  }, []);

  function replace(sign: Sign) {
    setCatalog((current) => {
      if (!current) return current;
      const exists = current.signs.some((s) => s.id === sign.id);
      const signs = exists ? current.signs.map((s) => (s.id === sign.id ? sign : s)) : [...current.signs, sign];
      signs.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "pt-BR"));
      return { ...current, signs };
    });
  }

  async function toggleActive(sign: Sign) {
    setBusyId(sign.id);
    setError("");
    try {
      replace(await api.updateSign(sign.id, { active: !sign.active }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!catalog) {
    return (
      <main className="page">
        {error ? <p className="form-error" role="alert">{error}</p> : <p className="muted">Carregando…</p>}
      </main>
    );
  }

  return (
    <main className="page">
      <p><Link to="/perfil">Voltar ao perfil</Link></p>
      <h1>Sinais</h1>
      <p className="muted">
        {catalog.signs.length} no catálogo. Um sinal desativado some da coleta, mas as gravações dele ficam.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}

      <ul className="sign-list">
        {catalog.signs.map((sign) => (
          <li key={sign.id} className="sign-admin">
            {editing === sign.id ? (
              <SignEditor
                catalog={catalog}
                sign={sign}
                onSaved={(saved) => { replace(saved); setEditing(null); }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="sign-row">
                <div>
                  <span className="sign-row__name">{sign.name}</span>
                  <span className="muted sign-row__meta">
                    {sign.recording_count} gravações{sign.active ? "" : " · desativado"}
                  </span>
                </div>
                <div className="sign-row__actions">
                  <button className="link-button" onClick={() => setEditing(sign.id)}>Editar</button>
                  <button className="link-button" disabled={busyId === sign.id} onClick={() => toggleActive(sign)}>
                    {sign.active ? "Desativar" : "Ativar"}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <h2>Novo sinal</h2>
      <SignEditor catalog={catalog} onSaved={replace} />
    </main>
  );
}
