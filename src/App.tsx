import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { errorMessage } from "./api";
import { messageFor } from "./messages";
import { useAuth } from "./auth";
import { NotificationsProvider } from "./notifications";
import { TabBar } from "./ui/TabBar";
import { AdminSigns } from "./pages/AdminSigns";
import { Collect } from "./pages/Collect";
import { MyRecordings } from "./pages/MyRecordings";
import { Profile } from "./pages/Profile";
import { Recognize } from "./pages/Recognize";
import { Register } from "./pages/Register";
import { Review } from "./pages/Review";
import { SignIn } from "./pages/SignIn";

function Shell() {
  const { session } = useAuth();
  if (session.state !== "ready") {
    return <div className="app"><Outlet /></div>;
  }
  return (
    <NotificationsProvider>
      <div className="app">
        <Outlet />
        <TabBar />
      </div>
    </NotificationsProvider>
  );
}

/** Routes that need a profile. Other states go to the start page. */
function NeedsProfile() {
  const { session } = useAuth();
  // Do not redirect while the session loads, or a direct link loses its path.
  if (session.state === "loading") return <main className="page"><p className="muted">Carregando…</p></main>;
  return session.state === "ready" ? <Outlet /> : <Navigate to="/" replace />;
}

/** Routes for administrators. Other people go to the profile. */
function NeedsAdmin() {
  const { session } = useAuth();
  if (session.state !== "ready") return <Outlet />;
  return session.profile.role === "admin" ? <Outlet /> : <Navigate to="/perfil" replace />;
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
          <h1>{messageFor("profile_load_failed")}</h1>
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
        <Route element={<NeedsProfile />}>
          <Route path="reconhecer" element={<Recognize />} />
          <Route path="coletar" element={<Collect />} />
          <Route path="analisar" element={<Review />} />
          <Route path="perfil" element={<Profile />} />
          <Route path="gravacoes" element={<MyRecordings />} />
          <Route element={<NeedsAdmin />}>
            <Route path="admin/sinais" element={<AdminSigns />} />
            {/* Route only. The screen waits for the layout decision. The API is in /api/admin/users. */}
            <Route path="admin/usuarios" element={<p>Em construção.</p>} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
