import { useEffect, useState } from "react";
import { api, errorMessage, type Sign } from "../api";
import { useProfile } from "../auth";

// Same limit as LIA_TARGET_PER_SIGN in the API.
const TARGET_PER_SIGN = 4;

export function Collect() {
  const profile = useProfile();
  const [signs, setSigns] = useState<Sign[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.signs().then((r) => setSigns(r.signs)).catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <main className="page"><p className="form-error" role="alert">{error}</p></main>;
  if (!signs) return <main className="page"><p className="muted">Carregando os sinais…</p></main>;

  if (signs.length === 0) {
    return (
      <main className="page">
        <h1>Coletar</h1>
        <p className="muted">Ainda não há sinais para gravar. Volte em breve.</p>
      </main>
    );
  }

  const done = signs.filter((s) => (profile.sign_recordings[s.id]?.length ?? 0) >= TARGET_PER_SIGN).length;

  return (
    <main className="page">
      <h1>Coletar</h1>
      <p className="muted">
        {done} de {signs.length} sinais completos. Cada sinal pede {TARGET_PER_SIGN} gravações.
      </p>
      <ul className="sign-list">
        {signs.map((sign) => {
          const count = profile.sign_recordings[sign.id]?.length ?? 0;
          return (
            <li key={sign.id} className="sign-row">
              <span className="sign-row__name">{sign.name}</span>
              <span className="sign-row__dots" aria-label={`${count} de ${TARGET_PER_SIGN} gravações`}>
                {Array.from({ length: TARGET_PER_SIGN }, (_, i) => (
                  <span key={i} className={i < count ? "dot dot--on" : "dot"} />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="note">A gravação com a câmera chega na próxima versão.</p>
    </main>
  );
}
