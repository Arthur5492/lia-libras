import { IconCamera, IconCards, IconHandStop, IconUser } from "@tabler/icons-react";
import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/reconhecer", label: "Reconhecer", icon: IconHandStop },
  { to: "/coletar", label: "Coletar", icon: IconCamera },
  null, // The gap in the middle. The record button of the collect screen sits on it.
  { to: "/analisar", label: "Analisar", icon: IconCards },
  { to: "/perfil", label: "Perfil", icon: IconUser },
] as const;

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Seções">
      {TABS.map((tab, i) =>
        tab === null ? (
          <span key={i} className="tabbar__gap" aria-hidden="true" />
        ) : (
          <NavLink key={tab.to} to={tab.to} className="tabbar__tab">
            <tab.icon aria-hidden="true" />
            <span>{tab.label}</span>
          </NavLink>
        ),
      )}
    </nav>
  );
}
