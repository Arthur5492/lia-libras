import { useState } from "react";
import { api, errorMessage } from "../api";
import { useAuth, useProfile } from "../auth";

const LEVEL_NAMES = { regular: "Regular", trusted: "Confiável", expert: "Especialista" } as const;

export function Profile() {
  const profile = useProfile();
  const { setProfile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggleRanking(show: boolean) {
    setBusy(true);
    setError("");
    try {
      setProfile(await api.updateMe(show));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page page--narrow">
      <h1>{profile.username}</h1>
      <dl className="facts">
        <div><dt>Gravações</dt><dd>{profile.recording_count}</dd></div>
        <div><dt>Nível</dt><dd>{LEVEL_NAMES[profile.trust_level]}{profile.role === "admin" && " (admin)"}</dd></div>
      </dl>
      <label className="check">
        <input
          type="checkbox"
          checked={profile.show_in_ranking}
          disabled={busy}
          onChange={(e) => toggleRanking(e.target.checked)}
        />
        <span>Mostrar meu nome de usuário no ranking público.</span>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button--quiet" onClick={signOut}>Sair</button>
    </main>
  );
}
