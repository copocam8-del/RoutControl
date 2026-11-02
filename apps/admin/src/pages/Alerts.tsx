import { type AppNotification, NOTIFICATION_LABEL, type NotificationType } from "@routcontrol/domain";
import { Badge, type BadgeTone, EmptyState, formatAgo, formatLongDate, formatTime, Loadable, useLoad } from "@routcontrol/ui";
import { useCallback, useEffect } from "react";

import { describeLoadError, useAdmin } from "../adminApp";
import { DemoChip, PageTitle } from "../Layout";
import { href } from "../router";

const describe = (e: unknown) => describeLoadError(e, "las alertas");

const TONE: Record<NotificationType, BadgeTone> = {
  WORKDAY_STARTED: "success",
  WORKDAY_ENDED: "neutral",
  NO_SIGNAL: "warning",
  INCIDENT: "error",
  ROUTE_FINISHED: "accent",
};

/** A dónde lleva cada alerta: la jornada o el paquete. */
function target(n: AppNotification): string | null {
  const p = n.payload as Record<string, string | undefined>;
  if (n.type === "INCIDENT" && p.package_id) return href({ name: "package", id: p.package_id });
  if (p.workday_id) return href({ name: "workday", id: p.workday_id });
  return null;
}

/** Alertas del panel (ADR-025): las últimas 50; al abrirlas, quedan vistas. */
export function Alerts() {
  const { api, alerts } = useAdmin();
  const load = useCallback(() => api.listNotifications(), [api]);
  const [state, reload] = useLoad(load, describe);
  useEffect(() => {
    if (state.status === "ready" && state.data.unread > 0) void alerts.markSeen();
  }, [state, alerts]);
  return (
    <>
      <PageTitle
        title="Alertas"
        description={
          <>
            Qué avisa el panel se elige en <a href={href({ name: "settings" })}>Configuración</a>
          </>
        }
        actions={<DemoChip />}
      />
      <Loadable state={state} loadingLabel="Cargando alertas…" onRetry={reload}>
        {({ notifications }) =>
          notifications.length === 0 ? (
            <section className="panel-card">
              <EmptyState title="Todavía no hay alertas." description="Inicio y fin de jornada, sin señal, incidencias y recorridos terminados aparecen acá." />
            </section>
          ) : (
            <ul className="alert-list" aria-label="Alertas">
              {notifications.map((n) => {
                const to = target(n);
                const content = (
                  <>
                    <Badge tone={TONE[n.type]}>{NOTIFICATION_LABEL[n.type]}</Badge>
                    <span className="alert-item__text">
                      <strong>{n.title}</strong>
                      {n.body ? <span className="rc-muted">{n.body}</span> : null}
                    </span>
                    <time className="rc-muted alert-item__time" dateTime={n.created_at} title={`${formatLongDate(n.created_at)} · ${formatTime(n.created_at)}`}>
                      {formatAgo(Date.parse(n.created_at), Date.now())}
                    </time>
                  </>
                );
                return (
                  <li key={n.id} className={`alert-item${n.unread ? " alert-item--unread" : ""}`}>
                    {to ? (
                      <a className="alert-item__link" href={to}>
                        {content}
                      </a>
                    ) : (
                      <div className="alert-item__link">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        }
      </Loadable>
    </>
  );
}
