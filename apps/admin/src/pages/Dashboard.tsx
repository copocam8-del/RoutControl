import { type DriverSummary, isWithoutSignal, type LivePosition, mergeLivePosition, NO_SIGNAL_MINUTES, type WorkdayWithDriver } from "@routcontrol/domain";
import {
  Avatar,
  Badge,
  EmptyState,
  formatAgo,
  formatLongDate,
  formatTime,
  greeting,
  IconCheck,
  IconPin,
  IconSync,
  initials,
  Loadable,
  LoadingState,
  useLoad,
} from "@routcontrol/ui";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { describeLoadError, useAdmin, useSession } from "../adminApp";
import { useNow } from "../hooks";
import { connectLive, type LiveStatus } from "../live";
import { DemoChip, PageTitle } from "../Layout";
import { href, today } from "../router";

// MapLibre (~1 MB) se descarga aparte.
const PositionsMap = lazy(() => import("@routcontrol/ui/map").then((m) => ({ default: m.PositionsMap })));

const describe = (e: unknown) => describeLoadError(e, "la operación de hoy");

/** Cada cuánto se vuelve a consultar el inicio. Las ubicaciones llegan además en vivo (ADR-017). */
export const REFRESH_MS = 30_000;

interface Today {
  workdays: WorkdayWithDriver[];
  drivers: DriverSummary[];
  at: number;
}

/** Primer nombre para el saludo ("Dueña Norte (demo)" → "Dueña"; un email → la parte antes de @). */
function firstName(nameOrEmail: string): string {
  return nameOrEmail.split("@")[0]!.replace(/\(.*?\)/g, "").trim().split(/\s+/)[0] ?? nameOrEmail;
}

/** Inicio (Panel.dc.html), con los datos reales del backend. */
export function Dashboard() {
  const { api } = useAdmin();
  const session = useSession();
  const date = today();
  const load = useCallback(async (): Promise<Today> => {
    const [workdays, drivers] = await Promise.all([api.listWorkdays(date), api.listDrivers()]);
    return { workdays, drivers, at: Date.now() };
  }, [api, date]);
  const [state, reload] = useLoad<Today>(load, describe, REFRESH_MS);
  const now = useNow(30_000);
  const live = useLivePositions();
  const user = session.status === "authenticated" ? session.session.user : null;

  return (
    <>
      <PageTitle
        eyebrow={formatLongDate(now)}
        title={user ? `${greeting(now)} ${firstName(user.full_name || user.email)}` : "Inicio"}
        actions={
          <>
            <DemoChip />
            {state.status === "ready" ? (
              live.status === "live" ? (
                <span className="updated-chip" title="Las ubicaciones se actualizan apenas llegan">
                  <span className="live-dot" aria-hidden="true" />
                  En vivo
                </span>
              ) : (
                <span className="updated-chip" title={`Se actualiza sola cada ${REFRESH_MS / 1000} s`}>
                  <IconSync size={16} />
                  Actualizado {formatTime(new Date(state.data.at).toISOString())}
                </span>
              )
            ) : null}
          </>
        }
      />
      <Loadable state={state} loadingLabel="Cargando la operación de hoy…" onRetry={reload}>
        {(data) => <Operation data={data} now={now} live={live.positions} />}
      </Loadable>
    </>
  );
}

/** Posiciones que llegan por WebSocket, por repartidor (la más reciente). */
function useLivePositions(): { status: LiveStatus; positions: Record<string, LivePosition> } {
  const { api, config, live } = useAdmin();
  const [status, setStatus] = useState<LiveStatus>("offline");
  const [positions, setPositions] = useState<Record<string, LivePosition>>({});
  useEffect(() => {
    if (!live.WebSocketImpl) return;
    return connectLive({
      origin: config.liveOrigin,
      getToken: (force) => api.accessTokenForSocket(force),
      onPosition: (p) => setPositions((known) => mergeLivePosition(known, p)),
      onStatus: setStatus,
      WebSocketImpl: live.WebSocketImpl,
      retryDelayMs: live.retryDelayMs,
    });
  }, [api, config.liveOrigin, live]);
  return { status, positions };
}

/**
 * Aplica las posiciones en vivo a los repartidores cargados: solo si son de la jornada activa que
 * conocemos y más nuevas que la última que trajo la consulta. Una jornada nueva aparece con la
 * próxima consulta (cada 30 s).
 */
export function withLivePositions(drivers: DriverSummary[], live: Record<string, LivePosition>): DriverSummary[] {
  return drivers.map((d) => {
    const p = live[d.id];
    const active = d.active_workday;
    if (!p || !active || p.workday_id !== active.id) return d;
    if (active.last_point_at && Date.parse(active.last_point_at) >= Date.parse(p.recorded_at)) return d;
    return { ...d, active_workday: { ...active, last_point_at: p.recorded_at, last_location: { lat: p.lat, lng: p.lng } } };
  });
}

function Operation({ data, now, live }: { data: Today; now: number; live: Record<string, LivePosition> }) {
  const { config } = useAdmin();
  const { workdays } = data;
  const drivers = useMemo(() => withLivePositions(data.drivers, live), [data.drivers, live]);
  const active = workdays.filter((w) => w.status === "ACTIVE");
  const liveByWorkday = new Map(Object.values(live).map((p) => [p.workday_id, p.recorded_at]));
  const lastSignal = (w: WorkdayWithDriver) => {
    const l = liveByWorkday.get(w.id);
    return l && (!w.last_point_at || Date.parse(l) > Date.parse(w.last_point_at)) ? l : w.last_point_at;
  };
  const silent = active.filter((w) => isWithoutSignal(lastSignal(w), w.started_at, now));
  const enabled = drivers.filter((d) => d.status === "ACTIVE" && d.membership_status === "ACTIVE");
  const working = enabled.filter((d) => d.active_workday);
  const positions = working.flatMap((d) =>
    d.active_workday!.last_location
      ? [
          {
            id: d.id,
            label: d.name,
            short: initials(d.name),
            ...d.active_workday!.last_location,
            stale: isWithoutSignal(d.active_workday!.last_point_at, d.active_workday!.started_at, now),
          },
        ]
      : [],
  );

  return (
    <>
      <section className="kpis rc-in" aria-label="Resumen de hoy" style={{ animationDelay: ".05s" }}>
        <div className="kpi kpi--hero">
          <span className="kpi__label">En jornada ahora</span>
          <span className="kpi__value">
            {working.length} <span className="kpi__of">de {enabled.length} repartidores</span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi__label">
            <span className="kpi__icon kpi__icon--ok" aria-hidden="true">
              <IconCheck size={18} />
            </span>
            Jornadas finalizadas
          </span>
          <span className="kpi__value">{workdays.length - active.length}</span>
        </div>
        <div className="kpi">
          <span className="kpi__label">
            <span className="kpi__icon kpi__icon--info" aria-hidden="true">
              <IconPin size={18} />
            </span>
            Ubicaciones registradas
          </span>
          <span className="kpi__value">{workdays.reduce((n, w) => n + w.point_count, 0).toLocaleString("es-AR")}</span>
        </div>
        <div className="kpi kpi--warn">
          <span className="kpi__label">
            <span className="kpi__icon kpi__icon--warn" aria-hidden="true">
              <IconNoSignal />
            </span>
            Sin señal hace más de {NO_SIGNAL_MINUTES} min
          </span>
          <span className="kpi__value">{silent.length}</span>
        </div>
      </section>

      <div className="split rc-in" style={{ animationDelay: ".1s" }}>
        <section className="panel-card panel-card--map" aria-label="Dónde están ahora">
          <div className="panel-card__head">
            <h2>Dónde están ahora</h2>
            <span className="rc-muted">Última ubicación de cada repartidor en jornada</span>
          </div>
          {positions.length === 0 ? (
            <EmptyState
              title="Nadie en jornada con ubicación."
              description="Cuando un repartidor inicie la jornada, su última ubicación aparece acá."
            />
          ) : (
            <Suspense fallback={<LoadingState label="Cargando mapa…" />}>
              <PositionsMap positions={positions} source={config.map} height={360} />
            </Suspense>
          )}
        </section>

        <section className="panel-card" aria-label="Repartidores">
          <div className="panel-card__title-row">
            <h2>Repartidores</h2>
            <a href={href({ name: "drivers" })}>Ver todos</a>
          </div>
          {enabled.length === 0 ? (
            <EmptyState title="Todavía no hay repartidores en esta empresa." />
          ) : (
            <ul className="people">
              {enabled.map((d) => (
                <li key={d.id}>
                  <DriverRow driver={d} workdays={workdays} now={now} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function IconNoSignal() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 8.8a15 15 0 0 1 20 0" />
      <path d="M5.5 12.4a10 10 0 0 1 13 0" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

function DriverRow({ driver, workdays, now }: { driver: DriverSummary; workdays: WorkdayWithDriver[]; now: number }) {
  const active = driver.active_workday;
  let detail: string;
  let badge;
  let link: string;
  if (active) {
    const silent = isWithoutSignal(active.last_point_at, active.started_at, now);
    link = href({ name: "workday", id: active.id });
    if (silent) {
      detail = active.last_point_at ? `Última señal ${formatAgo(Date.parse(active.last_point_at), now)}` : "Todavía no mandó ubicaciones";
      badge = <Badge tone="warning">Sin señal</Badge>;
    } else {
      detail = active.last_point_at
        ? `Desde ${formatTime(active.started_at)} · señal ${formatAgo(Date.parse(active.last_point_at), now)}`
        : `Desde ${formatTime(active.started_at)} · todavía sin ubicaciones`;
      badge = <Badge tone="success">En jornada</Badge>;
    }
  } else {
    const finished = workdays.find((w) => w.driver.id === driver.id && w.status !== "ACTIVE");
    link = finished ? href({ name: "workday", id: finished.id }) : href({ name: "drivers" });
    detail = finished?.ended_at ? `Terminó a las ${formatTime(finished.ended_at)}` : "Todavía no empezó";
    badge = finished ? <Badge tone="neutral">Finalizada</Badge> : <Badge tone="neutral">Sin jornada</Badge>;
  }
  return (
    <a className="person" href={link}>
      <Avatar name={driver.name} size={40} />
      <span className="person__text">
        <span className="person__name">{driver.name}</span>
        <span className="person__detail">{detail}</span>
      </span>
      {badge}
    </a>
  );
}
