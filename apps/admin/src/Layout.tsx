import { Avatar, Brand, IconCalendar, IconCheck, IconDashboard, IconLogout, IconMap, IconPackage, IconUsers, ThemeSelector } from "@routcontrol/ui";
import { type ReactNode, useEffect, useSyncExternalStore } from "react";

import { useAdmin, useSession } from "./adminApp";
import { href, type Route, today } from "./router";
import { ROLE_LABEL, type SessionInfo } from "./session";

const NAV: Array<{ label: string; route: Route; matches: Route["name"][]; icon: ReactNode }> = [
  { label: "Inicio", route: { name: "dashboard" }, matches: ["dashboard"], icon: <IconDashboard /> },
  { label: "Jornadas", route: { name: "workdays", date: today() }, matches: ["workdays", "workday"], icon: <IconMap /> },
  { label: "Paquetes", route: { name: "packages" }, matches: ["packages", "package", "import", "address"], icon: <IconPackage /> },
  { label: "Entregas", route: { name: "deliveries", date: today(), view: "deliveries" }, matches: ["deliveries"], icon: <IconCheck /> },
  { label: "Repartidores", route: { name: "drivers" }, matches: ["drivers"], icon: <IconUsers /> },
  { label: "Informes", route: { name: "reports", period: "week", date: today() }, matches: ["reports"], icon: <IconCalendar /> },
  { label: "Alertas", route: { name: "alerts" }, matches: ["alerts"], icon: <IconBell /> },
  { label: "Configuración", route: { name: "settings" }, matches: ["settings"], icon: <IconGear /> },
];

/** Barra lateral (Panel.dc.html). En pantallas angostas pasa arriba. */
export function Layout({ route, session, children }: { route: Route; session: SessionInfo; children: ReactNode }) {
  const app = useAdmin();
  const name = session.user.full_name || session.user.email;
  const alerts = useSyncExternalStore(
    (cb) => app.alerts.subscribe(cb),
    () => app.alerts.getState(),
  );
  // Alertas nuevas (ADR-025): cada 30 s; en el inicio, además, al instante por el WebSocket.
  useEffect(() => {
    void app.alerts.refresh();
    const id = setInterval(() => void app.alerts.refresh(), ALERTS_REFRESH_MS);
    return () => clearInterval(id);
  }, [app.alerts]);
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
                    {item.route.name === "alerts" && alerts.unread > 0 ? (
                      <span className="sidebar__count" aria-label={`${alerts.unread} nuevas`}>
                        {alerts.unread > 99 ? "99+" : alerts.unread}
                      </span>
                    ) : null}
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
      <div className="main">
        <header className="topbar" aria-label="Encabezado">
          <span className="topbar__label" aria-hidden="true">
            Apariencia
          </span>
          <ThemeSelector userId={session.user.id} compact />
        </header>
        <main className="content">{children}</main>
        {alerts.toast ? (
          <div className="alert-toast" role="status" aria-label="Nueva alerta">
            <a className="alert-toast__body" href={href({ name: "alerts" })} onClick={() => app.alerts.dismissToast()}>
              <strong>{alerts.toast.title}</strong>
              {alerts.toast.body ? <span>{alerts.toast.body}</span> : null}
            </a>
            <button type="button" className="alert-toast__close" aria-label="Cerrar aviso" onClick={() => app.alerts.dismissToast()}>
              ×
            </button>
          </div>
        ) : null}
      </div>
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

export const ALERTS_REFRESH_MS = 30_000;

function IconBell() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
