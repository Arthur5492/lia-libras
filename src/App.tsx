import { Link, Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import { errorMessage } from "./api";
import { useAuth } from "./auth";
import { Collect } from "./pages/Collect";
import { Profile } from "./pages/Profile";
import { Recognize } from "./pages/Recognize";
import { Register } from "./pages/Register";
import { Review } from "./pages/Review";
import { SignIn } from "./pages/SignIn";

function Shell() {
  const { session } = useAuth();
  const ready = session.state === "ready";
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="wordmark">Lia</Link>
        {ready ? (
          <Link to="/perfil" className="topbar__user">{session.profile.username}</Link>
        ) : (
          <Link to="/" className="topbar__user">Entrar</Link>
        )}
      </header>
      <Outlet />
      {ready && (
        <nav className="tabs" aria-label="Seções">
          <NavLink to="/coletar">Coletar</NavLink>
          <NavLink to="/reconhecer">Reconhecer</NavLink>
          <NavLink to="/analisar">Analisar</NavLink>
        </nav>
      )}
    </div>
  );
}

/** Routes that need a profile. Other states go to the start page. */
function NeedsProfile() {
  const { session } = useAuth();
  // Do not redirect while the session loads, or a direct link loses its path.
  if (session.state === "loading") return <main className="page"><p className="muted">Carregando…</p></main>;
  return session.state === "ready" ? <Outlet /> : <Navigate to="/" replace />;
}

function Start() {
  const { session, reload, signOut } = useAuth();
  switch (session.state) {
    case "loading":
      return <main className="page"><p className="muted">Carregando…</p></main>;
    case "signed_out":
      return <SignIn />;
    case "needs_profile":
      return <Register />;
    case "ready":
      return <Navigate to="/coletar" replace />;
    case "error":
      return (
        <main className="page page--narrow">
          <h1>Não foi possível carregar seu perfil</h1>
          <p className="form-error" role="alert">{errorMessage(session.error)}</p>
          <button className="button button--primary" onClick={reload}>Tentar de novo</button>
          <button className="button button--quiet" onClick={signOut}>Sair</button>
        </main>
      );
  }
}

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Start />} />
        <Route path="reconhecer" element={<Recognize />} />
        <Route element={<NeedsProfile />}>
          <Route path="coletar" element={<Collect />} />
          <Route path="analisar" element={<Review />} />
          <Route path="perfil" element={<Profile />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
