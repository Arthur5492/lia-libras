import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage, type Catalog, type MetadataSchema, type Sign, type SignInput } from "../api";

// ---------- one sign ----------

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
        <p className="field__help">O link precisa levar direto a um arquivo de vídeo (.mp4 ou .webm).</p>
      </div>
      {fields.length > 0 && (
        <fieldset className="tags">
          <legend>Características</legend>
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
        </fieldset>
      )}
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

// ---------- the tags ----------

/** The code of a tag has lower case letters, digits and "_", and starts with a letter. The server checks it too. */
const TAG_CODE = /^[a-z][a-z0-9_]*$/;

/** A code from the name of a tag: "Usa o rosto" gives "usa_o_rosto". It does not repeat a code that is taken. */
function codeFromLabel(label: string, taken: Set<string>): string {
  let code = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(code)) code = code ? `tag_${code}` : "tag";
  let unique = code;
  for (let n = 2; taken.has(unique); n += 1) unique = `${code}_${n}`;
  return unique;
}

interface Tag {
  key: string;
  label: string;
}

const toTags = (schema: MetadataSchema): Tag[] => Object.entries(schema).map(([key, field]) => ({ key, label: field.label }));

/** The tags that a sign can have. Each tag is a yes or no for each sign. */
function TagsEditor({ catalog, onSaved }: { catalog: Catalog; onSaved: (catalog: Catalog) => void }) {
  const [tags, setTags] = useState<Tag[]>(toTags(catalog.sign_metadata_schema));
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const saved = JSON.stringify(toTags(catalog.sign_metadata_schema));
  const changed = JSON.stringify(tags) !== saved;
  const taken = new Set(tags.map((tag) => tag.key));
  const codeProblem = code !== "" && (!TAG_CODE.test(code) || taken.has(code));

  function add(event: FormEvent) {
    event.preventDefault();
    if (!label.trim() || codeProblem) return;
    setTags([...tags, { key: code || codeFromLabel(label, taken), label: label.trim() }]);
    setLabel("");
    setCode("");
  }

  function remove(tag: Tag) {
    const sure = window.confirm(`Remover "${tag.label}"? Essa característica some de todos os sinais.`);
    if (sure) setTags(tags.filter((other) => other.key !== tag.key));
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const schema: MetadataSchema = Object.fromEntries(
        tags.map((tag) => [tag.key, { type: "boolean" as const, label: tag.label.trim() || tag.key }]),
      );
      const next = await api.updateMetadataSchema(schema);
      onSaved(next);
      setTags(toTags(next.sign_metadata_schema));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Características dos sinais</h2>
      <p className="muted">
        Cada característica é um sim ou não em cada sinal, por exemplo "Dinâmico" ou "Duas mãos". Ao adicionar uma,
        todos os sinais ficam com ela em "não" até você marcar.
      </p>
      <ul className="sign-list">
        {tags.length === 0 && <li className="sign-row muted">Nenhuma característica.</li>}
        {tags.map((tag) => (
          <li key={tag.key} className="sign-row">
            <div className="field">
              <label className="sr-only" htmlFor={`tag-${tag.key}`}>Nome da característica {tag.key}</label>
              <input
                id={`tag-${tag.key}`}
                value={tag.label}
                onChange={(e) => setTags(tags.map((other) => (other.key === tag.key ? { ...other, label: e.target.value } : other)))}
              />
              <p className="field__help">código: {tag.key}</p>
            </div>
            <button type="button" className="link-button" onClick={() => remove(tag)}>Remover</button>
          </li>
        ))}
      </ul>

      <form className="form editor" onSubmit={add}>
        <div className="field">
          <label htmlFor="tag-new-label">Nova característica</label>
          <input id="tag-new-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Por exemplo: Usa o rosto" />
        </div>
        <div className="field">
          <label htmlFor="tag-new-code">Código (opcional)</label>
          <input
            id="tag-new-code"
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            placeholder={label.trim() ? codeFromLabel(label, taken) : "is_dynamic"}
            aria-invalid={codeProblem}
          />
          <p className={codeProblem ? "field__help form-error" : "field__help"}>
            {codeProblem
              ? "Use letras minúsculas, números e _, comece com letra e não repita um código."
              : "Deixe vazio para criar o código a partir do nome."}
          </p>
        </div>
        <button className="button button--quiet" disabled={!label.trim() || codeProblem}>Adicionar à lista</button>
      </form>

      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="button" className="button button--primary" disabled={!changed || busy} onClick={save}>
        {busy ? "Salvando…" : "Salvar características"}
      </button>
    </section>
  );
}

// ---------- the page ----------

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
      signs.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
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

  /** The tags that a sign has, as a text. */
  const tagsOf = (sign: Sign) =>
    Object.entries(catalog.sign_metadata_schema)
      .filter(([key]) => sign.sign_metadata[key])
      .map(([, field]) => field.label)
      .join(" · ");

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
                    {tagsOf(sign) && ` · ${tagsOf(sign)}`}
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

      <TagsEditor key={JSON.stringify(catalog.sign_metadata_schema)} catalog={catalog} onSaved={setCatalog} />
    </main>
  );
}
