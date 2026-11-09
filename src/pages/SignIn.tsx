import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { HandMark } from "../components/HandMark";

export function SignIn() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSignIn() {
    setBusy(true);
    setFailed(false);
    try {
      await signIn();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <HandMark className="signin__hand" />
      <div className="signin__text">
        <h1>Suas mãos ensinam Libras a um computador</h1>
        <p>
          Grave sinais com a câmera do celular. O vídeo não sai do aparelho: só os pontos das mãos e do corpo são
          enviados, para um conjunto de dados aberto.
        </p>
        <button className="button button--primary" onClick={handleSignIn} disabled={busy}>
          {busy ? "Abrindo o Google…" : "Entrar com Google"}
        </button>
        {failed && <p className="form-error" role="alert">Não foi possível entrar. Tente de novo.</p>}
        <p className="signin__alt">
          Só quer testar? <Link to="/reconhecer">Reconhecer sinais sem entrar</Link>
        </p>
      </div>
    </main>
  );
}
