import { Badge, Button } from "@routcontrol/ui";
import type { ReactNode } from "react";

import { useAdmin } from "./adminApp";
import { Brand } from "./Brand";
import { href, type Route, today } from "./router";
import { ROLE_LABEL, type SessionInfo } from "./session";

const NAV: Array<{ label: string; route: Route; matches: Route["name"][] }> = [
  { label: "Inicio", route: { name: "dashboard" }, matches: ["dashboard"] },
  { label: "Jornadas", route: { name: "workdays", date: today() }, matches: ["workdays", "workday"] },
  { label: "Repartidores", route: { name: "drivers" }, matches: ["drivers"] },
];

/** Barra lateral + encabezado. En pantallas angostas la barra pasa arriba. */
export function Layout({ route, session, children }: { route: Route; session: SessionInfo; children: ReactNode }) {
  const app = useAdmin();
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand name={app.config.appName} subtitle="Panel" inverse />
        <nav aria-label="Secciones">
          <ul className="sidebar__nav">
            {NAV.map((item) => {
              const current = item.matches.includes(route.name);
              return (
                <li key={item.label}>
                  <a className="sidebar__link" href={href(item.route)} aria-current={current ? "page" : undefined}>
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <div className="main">
        <header className="header">
          <div className="header__org">
            <strong>{session.organization.name}</strong>
            {session.organization.is_demo ? <Badge tone="warning">Datos de demostración</Badge> : null}
          </div>
          <div className="header__user">
            <span>
              {session.user.full_name || session.user.email} · <span className="rc-muted">{ROLE_LABEL[session.role]}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => void app.session.logout()}>
              Salir
            </Button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

export function PageTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {description ? <p className="rc-muted">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}
