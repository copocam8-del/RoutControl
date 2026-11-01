import { Avatar, Brand, IconDashboard, IconLogout, IconMap, IconUsers } from "@routcontrol/ui";
import type { ReactNode } from "react";

import { useAdmin, useSession } from "./adminApp";
import { href, type Route, today } from "./router";
import { ROLE_LABEL, type SessionInfo } from "./session";

const NAV: Array<{ label: string; route: Route; matches: Route["name"][]; icon: ReactNode }> = [
  { label: "Inicio", route: { name: "dashboard" }, matches: ["dashboard"], icon: <IconDashboard /> },
  { label: "Jornadas", route: { name: "workdays", date: today() }, matches: ["workdays", "workday"], icon: <IconMap /> },
  { label: "Repartidores", route: { name: "drivers" }, matches: ["drivers"], icon: <IconUsers /> },
];

/** Barra lateral (Panel.dc.html). En pantallas angostas pasa arriba. */
export function Layout({ route, session, children }: { route: Route; session: SessionInfo; children: ReactNode }) {
  const app = useAdmin();
  const name = session.user.full_name || session.user.email;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Brand name={app.config.appName} markSize={42} textSize={19} hole="var(--rc-sidebar)" />
        </div>
        <nav aria-label="Secciones">
          <ul className="sidebar__nav">
            {NAV.map((item) => {
              const current = item.matches.includes(route.name);
              return (
                <li key={item.label}>
                  <a className="sidebar__link" href={href(item.route)} aria-current={current ? "page" : undefined}>
                    {item.icon}
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="sidebar__foot">
          <div className="user-card">
            <Avatar name={name} size={40} ring />
            <div className="user-card__text">
              <span className="user-card__name">{name}</span>
              <span className="user-card__role">
                {ROLE_LABEL[session.role]} · {session.organization.name}
              </span>
            </div>
          </div>
          <button type="button" className="sidebar__logout" onClick={() => void app.session.logout()}>
            <IconLogout size={18} />
            Salir
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

export function PageTitle({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div className="page-title__main">
        {back}
        <div className="page-title__text">
          {eyebrow ? <span className="rc-eyebrow">{eyebrow}</span> : null}
          <h1>{title}</h1>
          {description ? <div className="page-title__description">{description}</div> : null}
        </div>
      </div>
      {actions ? <div className="page-title__actions">{actions}</div> : null}
    </div>
  );
}

/** Marca de demostración: siempre visible arriba de cada página cuando la empresa es de demo. */
export function DemoChip() {
  const state = useSession();
  if (state.status !== "authenticated" || !state.session.organization.is_demo) return null;
  return (
    <span className="rc-chip rc-chip--warn">
      <span className="rc-chip__dot" aria-hidden="true" />
      Datos de demostración
    </span>
  );
}
