import { isWithoutSignal, type WorkdayTrack, type WorkdayWithDriver } from "@routcontrol/domain";
import {
  Avatar,
  Badge,
  EmptyState,
  formatDistance,
  formatDuration,
  formatTime,
  IconArrowRight,
  IconCalendar,
  Loadable,
  LoadingState,
  useLoad,
} from "@routcontrol/ui";
import { lazy, Suspense, useCallback, useState } from "react";

import { describeLoadError, useAdmin } from "../adminApp";
import { useNow } from "../hooks";
import { DemoChip } from "../Layout";
import { href, navigate, today } from "../router";

// MapLibre (~1 MB) se carga recién al elegir una jornada.
const TrackMap = lazy(() => import("@routcontrol/ui/map").then((m) => ({ default: m.TrackMap })));

const describeList = (e: unknown) => describeLoadError(e, "las jornadas");
const describeTrack = (e: unknown) => describeLoadError(e, "el recorrido");

type Filter = "all" | "active" | "finished";

/** "Hoy, domingo 1 de noviembre", "Ayer, sábado 31 de octubre" o "Viernes 30 de octubre". */
export function dayLabel(date: string, now: Date = new Date()): string {
  const d = new Date(`${date}T12:00:00`);
  const long = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
  if (date === today(now)) return `Hoy, ${long}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date === today(yesterday)) return `Ayer, ${long}`;
  return long.charAt(0).toUpperCase() + long.slice(1);
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return today(d);
}

function span(w: WorkdayWithDriver): string {
  return `${formatTime(w.started_at)} – ${w.ended_at ? formatTime(w.ended_at) : "ahora"}`;
}

function duration(w: WorkdayWithDriver, now: number): string {
  return formatDuration(((w.ended_at ? Date.parse(w.ended_at) : now) - Date.parse(w.started_at)) / 1000);
}

/** Jornadas de un día (PanelJornadas.dc.html): filtros, tabla y el recorrido de la fila elegida. */
export function Workdays({ date }: { date: string }) {
  const { api } = useAdmin();
  const load = useCallback(() => api.listWorkdays(date), [api, date]);
  const [state, reload] = useLoad<WorkdayWithDriver[]>(load, describeList);
  const now = useNow(30_000);
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const isToday = date === today();

  return (
    <>
      <div className="page-title">
        <h1>Jornadas</h1>
        <div className="page-title__actions">
          <DemoChip />
          <div className="day-nav" role="group" aria-label="Día">
            <button type="button" className="day-nav__btn" aria-label="Día anterior" onClick={() => navigate({ name: "workdays", date: shiftDate(date, -1) })}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 6-6 6 6 6" />
              </svg>
            </button>
            <label className="day-nav__label">
              <IconCalendar size={18} />
              <span>{dayLabel(date)}</span>
              {/* El calendario del navegador, para saltar a cualquier día. */}
              <input
                type="date"
                className="day-nav__input"
                aria-label="Elegir día"
                value={date}
                max={today()}
                onChange={(e) => e.target.value && navigate({ name: "workdays", date: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="day-nav__btn"
              aria-label="Día siguiente"
              disabled={isToday}
              onClick={() => navigate({ name: "workdays", date: shiftDate(date, 1) })}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <Loadable
        state={state}
        loadingLabel="Cargando jornadas…"
        onRetry={reload}
        isEmpty={(items) => items.length === 0}
        empty={
          <section className="panel-card">
            <EmptyState title="No hay jornadas ese día." description="Probá con otro día con las flechas o el calendario." />
          </section>
        }
      >
        {(items) => {
          const active = items.filter((w) => w.status === "ACTIVE");
          const shown = filter === "all" ? items : filter === "active" ? active : items.filter((w) => w.status !== "ACTIVE");
          const selected = shown.find((w) => w.id === picked) ?? shown[0] ?? null;
          const chip = (id: Filter, label: string, count: number) => (
            <button type="button" className="filter-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label} · {count}
            </button>
          );
          return (
            <>
              <div className="filters" role="group" aria-label="Filtrar jornadas">
                {chip("all", "Todas", items.length)}
                {chip("active", "En curso", active.length)}
                {chip("finished", "Finalizadas", items.length - active.length)}
              </div>
              <div className="split split--workdays">
                <section className="panel-card panel-card--flush" aria-label="Jornadas del día">
                  {shown.length === 0 ? (
                    <EmptyState title="No hay jornadas con este filtro." />
                  ) : (
                    <div className="table-wrap">
                      <table className="rc-table workdays-table">
                        <caption className="rc-visually-hidden">Jornadas del {dayLabel(date)}. Elegí una para ver su recorrido.</caption>
                        <thead>
                          <tr>
                            <th scope="col">Repartidor</th>
                            <th scope="col">Horario</th>
                            <th scope="col">Duración</th>
                            <th scope="col">Ubicaciones</th>
                            <th scope="col">Huecos</th>
                            <th scope="col">Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((w) => (
                            <tr
                              key={w.id}
                              className="rc-table__row--link"
                              aria-selected={selected?.id === w.id}
                              onClick={() => setPicked(w.id)}
                            >
                              <td>
                                <span className="name-cell">
                                  <Avatar name={w.driver.name} size={36} />
                                  <button type="button" className="row-pick" onClick={() => setPicked(w.id)} aria-pressed={selected?.id === w.id}>
                                    {w.driver.name}
                                  </button>
                                </span>
                              </td>
                              <td className="rc-num">{span(w)}</td>
                              <td className="rc-num">{duration(w, now)}</td>
                              <td className="rc-num">{w.point_count.toLocaleString("es-AR")}</td>
                              <td className={["rc-num", w.gap_count > 0 && "gaps--some"].filter(Boolean).join(" ")}>{w.gap_count}</td>
                              <td>
                                <WorkdayBadge workday={w} now={now} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
                {selected ? <TrackPanel key={selected.id} workday={selected} now={now} /> : null}
              </div>
            </>
          );
        }}
      </Loadable>
    </>
  );
}

export function WorkdayBadge({ workday, now }: { workday: WorkdayWithDriver; now: number }) {
  if (workday.status !== "ACTIVE") return <Badge tone="neutral">Finalizada</Badge>;
  if (isWithoutSignal(workday.last_point_at, workday.started_at, now)) return <Badge tone="warning">En curso · sin señal</Badge>;
  return <Badge tone="success">En curso</Badge>;
}

/** Recorrido de la jornada elegida, al costado de la tabla. */
function TrackPanel({ workday, now }: { workday: WorkdayWithDriver; now: number }) {
  const { api, config } = useAdmin();
  const load = useCallback(() => api.workdayTrack(workday.id), [api, workday.id]);
  const [state, reload] = useLoad<WorkdayTrack>(load, describeTrack);

  return (
    <section className="panel-card panel-card--track" aria-label="Recorrido de la jornada elegida">
      <div className="track-panel__head">
        <span className="rc-eyebrow">Recorrido</span>
        <span className="track-panel__name">{workday.driver.name}</span>
        <span className="rc-muted">
          {span(workday)} · {duration(workday, now)}
        </span>
      </div>
      <Loadable state={state} loadingLabel="Cargando recorrido…" onRetry={reload}>
        {(track) =>
          track.stats.point_count === 0 ? (
            <EmptyState title="Sin ubicaciones registradas." description="La app estuvo cerrada o sin permiso de ubicación." />
          ) : (
            <>
              <Suspense fallback={<LoadingState label="Cargando mapa…" />}>
                <div className="track-panel__map">
                  <TrackMap track={track} styleUrl={config.mapStyleUrl} height={260} live={track.workday.ended_at === null} />
                </div>
              </Suspense>
              <div className="track-panel__stats" aria-label="Resumen del recorrido" role="group">
                <div>
                  <span>Distancia</span>
                  <strong>{formatDistance(track.stats.distance_m)}</strong>
                </div>
                <div>
                  <span>Tramos sin datos</span>
                  <strong className="gaps--some">{track.stats.gap_count}</strong>
                </div>
              </div>
            </>
          )
        }
      </Loadable>
      <a className="track-panel__more" href={href({ name: "workday", id: workday.id })}>
        Ver el recorrido completo
        <IconArrowRight size={16} />
      </a>
    </section>
  );
}
