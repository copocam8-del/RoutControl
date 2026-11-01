import { type DriverSummary, isWithoutSignal, NO_SIGNAL_MINUTES, type WorkdayWithDriver } from "@routcontrol/domain";
import { Avatar, Badge, Button, EmptyState, formatAgo, formatLongDate, formatTime, Loadable, LoadingState, useLoad } from "@routcontrol/ui";
import { lazy, Suspense, useCallback } from "react";

import { describeLoadError, useAdmin } from "../adminApp";
import { useNow } from "../hooks";
import { DemoChip, PageTitle } from "../Layout";
import { href, navigate, today } from "../router";
import { WorkdayTable } from "../WorkdayTable";

// MapLibre (~1 MB) se descarga aparte.
const PositionsMap = lazy(() => import("@routcontrol/ui/map").then((m) => ({ default: m.PositionsMap })));

const describe = (e: unknown) => describeLoadError(e, "la operación de hoy");

/** Cada cuánto se vuelve a consultar el inicio (no hay WebSocket en la etapa 0). */
export const REFRESH_MS = 30_000;

interface Today {
  workdays: WorkdayWithDriver[];
  drivers: DriverSummary[];
  at: number;
}

/** Inicio (Panel.dc.html): así va la operación hoy, con los datos reales del backend. */
export function Dashboard() {
  const { api } = useAdmin();
  const date = today();
  const load = useCallback(
    async (): Promise<Today> => {
      const [workdays, drivers] = await Promise.all([api.listWorkdays(date), api.listDrivers()]);
      return { workdays, drivers, at: Date.now() };
    },
    [api, date],
  );
  const [state, reload] = useLoad<Today>(load, describe, REFRESH_MS);
  const now = useNow(30_000);

  return (
    <>
      <PageTitle
        eyebrow={formatLongDate(now)}
        title="Así va la operación hoy"
        actions={
          <>
            <DemoChip />
            {state.status === "ready" ? (
              <span className="rc-chip rc-chip--ok updated-chip" title={`Se actualiza sola cada ${REFRESH_MS / 1000} s`}>
                <span className="rc-chip__dot" aria-hidden="true" />
                Actualizado {formatTime(new Date(state.data.at).toISOString())}
              </span>
            ) : null}
            <Button variant="secondary" size="sm" onClick={reload}>
              Actualizar
            </Button>
          </>
        }
      />
      <Loadable state={state} loadingLabel="Cargando la operación de hoy…" onRetry={reload}>
        {(data) => <Operation data={data} now={now} />}
      </Loadable>
    </>
  );
}

function Operation({ data, now }: { data: Today; now: number }) {
  const { config } = useAdmin();
  const { workdays, drivers } = data;
  const active = workdays.filter((w) => w.status === "ACTIVE");
  const silent = active.filter((w) => isWithoutSignal(w.last_point_at, w.started_at, now));
  const enabled = drivers.filter((d) => d.status === "ACTIVE" && d.membership_status === "ACTIVE");
  const working = enabled.filter((d) => d.active_workday);
  const positions = working.flatMap((d) =>
    d.active_workday!.last_location
      ? [
          {
            id: d.id,
            label: d.name,
            ...d.active_workday!.last_location,
            stale: isWithoutSignal(d.active_workday!.last_point_at, d.active_workday!.started_at, now),
          },
        ]
      : [],
  );

  return (
    <>
      <section className="kpis" aria-label="Resumen de hoy">
        <div className="kpi">
          <span className="kpi__label">Repartidores en jornada</span>
          <span className="kpi__value">
            {working.length} <span className="kpi__of">de {enabled.length}</span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi__label">Jornadas finalizadas</span>
          <span className="kpi__value kpi__value--ok">{workdays.length - active.length}</span>
        </div>
        <div className="kpi">
          <span className="kpi__label">Ubicaciones registradas</span>
          <span className="kpi__value">{workdays.reduce((n, w) => n + w.point_count, 0).toLocaleString("es-AR")}</span>
        </div>
        <div className="kpi">
          <span className="kpi__label">Sin señal hace +{NO_SIGNAL_MINUTES} min</span>
          <span className="kpi__value kpi__value--warn">{silent.length}</span>
        </div>
      </section>

      <div className="split">
        <section className="panel-card panel-card--map" aria-label="Mapa de la operación">
          <div className="panel-card__head">
            <h2>Mapa de la operación</h2>
            <span className="rc-muted">Última ubicación de cada repartidor</span>
          </div>
          {positions.length === 0 ? (
            <EmptyState
              title="Nadie en jornada con ubicación."
              description="Cuando un repartidor inicie la jornada, su última ubicación aparece acá."
            />
          ) : (
            <Suspense fallback={<LoadingState label="Cargando mapa…" />}>
              <PositionsMap positions={positions} styleUrl={config.mapStyleUrl} />
            </Suspense>
          )}
        </section>

        <section className="panel-card" aria-label="Repartidores">
          <h2 className="panel-card__title">Repartidores</h2>
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

      <section className="panel-card" aria-label="Jornadas de hoy">
        <h2 className="panel-card__title">Jornadas de hoy</h2>
        {workdays.length === 0 ? (
          <EmptyState
            title="Hoy todavía no empezó ninguna jornada."
            description="Cuando un repartidor toque “Iniciar jornada” en la app, aparece acá."
            action={
              <Button variant="secondary" onClick={() => navigate({ name: "drivers" })}>
                Ver repartidores
              </Button>
            }
          />
        ) : (
          <WorkdayTable workdays={workdays} now={now} caption="Jornadas de hoy" />
        )}
      </section>
    </>
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
      detail = `Desde las ${formatTime(active.started_at)}`;
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
      <Avatar name={driver.name} size={38} />
      <span className="person__text">
        <span className="person__name">{driver.name}</span>
        <span className="person__detail">{detail}</span>
      </span>
      {badge}
    </a>
  );
}
