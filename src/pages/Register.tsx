import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { CONSENT_PARAGRAPHS, CONSENT_VERSION } from "../consent";

type NameState = { kind: "idle" } | { kind: "checking" } | { kind: "free" } | { kind: "problem"; message: string };

export function Register() {
  const { setProfile, signOut } = useAuth();
  const [username, setUsername] = useState("");
  const [nameState, setNameState] = useState<NameState>({ kind: "idle" });
  const [consent, setConsent] = useState(false);
  const [ranking, setRanking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Check the name a short time after the person stops typing. The server checks again on save.
  useEffect(() => {
    const name = username.trim();
    if (name.length < 3) {
      setNameState({ kind: "idle" });
      return;
    }
    setNameState({ kind: "checking" });
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const result = await api.usernameAvailable(name);
        if (active) {
          setNameState(result.available ? { kind: "free" } : { kind: "problem", message: "Esse nome já está em uso." });
        }
      } catch (e) {
        if (active) setNameState({ kind: "problem", message: errorMessage(e) });
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [username]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setProfile(await api.register(username.trim(), CONSENT_VERSION, ranking));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const canSubmit = consent && nameState.kind === "free" && !busy;

  return (
    <main className="page page--narrow">
      <h1>Crie seu perfil</h1>
      <form onSubmit={handleSubmit} className="form">
        <div className="field">
          <label htmlFor="username">Nome de usuário</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={20}
            aria-describedby="username-help"
          />
          <p id="username-help" className="field__help" aria-live="polite">
            {nameState.kind === "idle" && "De 3 a 20 letras, números ou _. Não use seu nome real: ele pode aparecer no ranking."}
            {nameState.kind === "checking" && "Verificando…"}
            {nameState.kind === "free" && <span className="ok">Disponível.</span>}
            {nameState.kind === "problem" && <span className="bad">{nameState.message}</span>}
          </p>
        </div>

        <section className="consent" aria-labelledby="consent-title">
          <h2 id="consent-title">Termo de consentimento</h2>
          <div className="consent__text" tabIndex={0}>
            {CONSENT_PARAGRAPHS.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </section>

        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Li e aceito o termo de consentimento.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={ranking} onChange={(e) => setRanking(e.target.checked)} />
          <span>Mostrar meu nome de usuário no ranking público. Você pode mudar isso depois.</span>
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button--primary" disabled={!canSubmit}>
          {busy ? "Criando…" : "Criar perfil"}
        </button>
        <button type="button" className="button button--quiet" onClick={signOut}>
          Sair desta conta
        </button>
      </form>
    </main>
  );
}
