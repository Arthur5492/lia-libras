import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { GOOGLE_CLIENT_ID, GoogleButton } from "../components/GoogleButton";
import { HandMark } from "../components/HandMark";
import { messageFor } from "../messages";

export function SignIn() {
  const { signIn, signInWithToken } = useAuth();
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
        <h1>Lia Libras</h1>
        <p>
          Faça parte da comunidade que fará com que a educação de Libras se torne acessível a todos, contribua para
          gerar o maior banco de dados de Libras que já existiu!!
        </p>
        {GOOGLE_CLIENT_ID ? (
          <GoogleButton
            clientId={GOOGLE_CLIENT_ID}
            onCredential={(token) => signInWithToken(token).catch(() => setFailed(true))}
            onError={() => setFailed(true)}
          />
        ) : (
          <button className="button button--primary" onClick={handleSignIn} disabled={busy}>
            {busy ? "Abrindo o Google…" : "Entrar com Google"}
          </button>
        )}
        {failed && <p className="form-error" role="alert">{messageFor("sign_in_failed")}</p>}
        <p className="signin__alt">
          Só quer testar? <Link to="/reconhecer">Reconhecer sinais sem entrar</Link>
        </p>
      </div>
    </main>
  );
}
