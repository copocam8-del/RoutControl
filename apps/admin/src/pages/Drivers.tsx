import { type DriverSummary, isWithoutSignal } from "@routcontrol/domain";
import { EmptyState, formatAgo, formatDayTime, formatTime, IconArrowRight, initials, Loadable, useLoad } from "@routcontrol/ui";
import { useCallback, useState } from "react";

import { describeLoadError, useAdmin, useSession } from "../adminApp";
import { useNow } from "../hooks";
import { DemoChip } from "../Layout";
import { href } from "../router";

const describe = (e: unknown) => describeLoadError(e, "los repartidores");

type DriverState = "on" | "nosig" | "off" | "disabled";

const STATE: Record<DriverState, { label: string; tone: string }> = {
  on: { label: "En jornada", tone: "ok" },
  nosig: { label: "Sin señal", tone: "warn" },
  off: { label: "Sin jornada", tone: "off" },
  disabled: { label: "De baja", tone: "off" },
};

export function driverState(d: DriverSummary, now: number): DriverState {
  if (d.status !== "ACTIVE" || d.membership_status !== "ACTIVE") return "disabled";
  if (!d.active_workday) return "off";
  return isWithoutSignal(d.active_workday.last_point_at, d.active_workday.started_at, now) ? "nosig" : "on";
}

function matches(d: DriverSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || d.name.toLowerCase().includes(q) || d.email.toLowerCase().includes(q);
}

/** Repartidores (PanelRepartidores.dc.html): buscador y una tarjeta por repartidor. */
export function Drivers() {
  const { api } = useAdmin();
  const session = useSession();
  const load = useCallback(() => api.listDrivers(), [api]);
  const [state, reload] = useLoad<DriverSummary[]>(load, describe);
  const now = useNow(30_000);
  const [query, setQuery] = useState("");
  const org = session.status === "authenticated" ? session.session.organization.name : "";

  return (
    <>
      <div className="page-title">
        <div className="page-title__text">
          <h1>Repartidores</h1>
          {state.status === "ready" ? (
            <span className="page-title__description">
              {state.data.length === 1 ? "1 repartidor" : `${state.data.length} repartidores`} en {org}
            </span>
          ) : null}
        </div>
        <div className="page-title__actions">
          <DemoChip />
          <div className="search">
            <label htmlFor="buscar" className="rc-visually-hidden">
              Buscar repartidor
            </label>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="search__icon">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input id="buscar" type="search" placeholder="Buscar por nombre o email" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </div>
      <Loadable
        state={state}
        loadingLabel="Cargando repartidores…"
        onRetry={reload}
        isEmpty={(items) => items.length === 0}
        empty={
          <section className="panel-card">
            <EmptyState title="Todavía no hay repartidores en esta empresa." />
          </section>
        }
      >
        {(drivers) => {
          const shown = drivers.filter((d) => matches(d, query));
          return shown.length === 0 ? (
            <section className="panel-card">
              <EmptyState title={`Ningún repartidor coincide con “${query.trim()}”.`} />
            </section>
          ) : (
            <ul className="driver-grid" aria-label="Repartidores">
              {shown.map((d) => (
                <li key={d.id}>
                  <DriverCard driver={d} now={now} />
                </li>
              ))}
            </ul>
          );
        }}
      </Loadable>
    </>
  );
}

function DriverCard({ driver, now }: { driver: DriverSummary; now: number }) {
  const s = driverState(driver, now);
  const meta = STATE[s];
  const active = driver.active_workday;
  const last = driver.last_workday;

  // Dos datos reales: la jornada (desde cuándo) y la última señal; sin jornada, la última jornada.
  const tiles: Array<[string, string]> = active
    ? [
        ["Jornada", `Desde ${formatTime(active.started_at)}`],
        ["Última señal", active.last_point_at ? capitalize(formatAgo(Date.parse(active.last_point_at), now)) : "Todavía ninguna"],
      ]
    : [
        ["Jornada", s === "disabled" ? "De baja" : "No empezó"],
        ["Última jornada", last ? formatDayTime(last.ended_at ?? last.started_at, now) : "Nunca"],
      ];
  const cta = active
    ? { label: "Ver recorrido de hoy", to: href({ name: "workday", id: active.id }) }
    : last
      ? { label: "Ver última jornada", to: href({ name: "workday", id: last.id }) }
      : null;

  return (
    <article className={`driver-card driver-card--${meta.tone}`} aria-label={driver.name}>
      <div className="driver-card__who">
        <span className={`driver-card__avatar${active ? " driver-card__avatar--on" : ""}`} aria-hidden="true">
          {initials(driver.name)}
        </span>
        <div className="driver-card__text">
          <span className="driver-card__name">{driver.name}</span>
          <span className="driver-card__email">{driver.email}</span>
        </div>
      </div>
      <span className={`driver-card__state driver-card__state--${meta.tone}`}>
        <span className="driver-card__dot" aria-hidden="true" />
        {meta.label}
      </span>
      <div className="driver-card__tiles">
        {tiles.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {cta ? (
        <a className="driver-card__cta" href={cta.to}>
          {cta.label}
          <IconArrowRight size={16} />
        </a>
      ) : null}
    </article>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
