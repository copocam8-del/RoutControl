import type { WorkdayTrack, WorkdayWithDriver } from "@routcontrol/domain";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { ApiError, NetworkError } from "../api/client";
import { useApp } from "./hooks";

const TrackMap = lazy(() => import("./TrackMap").then((m) => ({ default: m.TrackMap })));

export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

/** Estado de una carga: siempre UNO solo (nunca "cargando" y "error" a la vez). */
type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

export function describeLoadError(error: unknown, what: string): string {
  if (error instanceof NetworkError) return `Sin conexión con el servidor: no se pudo cargar ${what}.`;
  if (error instanceof ApiError) {
    if (error.status === 404) return `No se encontró ${what}.`;
    if (error.status === 401 || error.status === 403) return "Tu sesión venció. Volvé a ingresar.";
    return `No se pudo cargar ${what} (error ${error.status}).`;
  }
  return `No se pudo cargar ${what}.`;
}

/** Carga datos con un estado único y un `reload` para el botón "Reintentar". */
function useLoad<T>(load: (() => Promise<T>) | null, what: string): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!load) return;
    let current = true;
    setState({ status: "loading" });
    load()
      .then((data) => current && setState({ status: "ready", data }))
      .catch((error) => current && setState({ status: "error", message: describeLoadError(error, what) }));
    return () => {
      current = false; // una respuesta vieja (otra jornada, otro intento) no pisa la actual
    };
  }, [load, what, attempt]);

  return [state, useCallback(() => setAttempt((n) => n + 1), [])];
}

function LoadError({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="stack">
      <p className="alert alert--error" role="alert">
        {message}
      </p>
      <button className="btn btn--secondary" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}

/** "Mis recorridos": las jornadas propias y el recorrido de cada una, con los huecos marcados. */
export function TrackScreen({ onBack }: { onBack(): void }) {
  const app = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const loadList = useCallback(() => app.api.listWorkdays(), [app]);
  const loadTrack = useCallback(() => app.api.workdayTrack(selected!), [app, selected]);
  const [list, reloadList] = useLoad<WorkdayWithDriver[]>(loadList, "las jornadas");
  const [track, reloadTrack] = useLoad<WorkdayTrack>(selected ? loadTrack : null, "el recorrido");

  return (
    <main className="screen">
      <header className="topbar">
        <button className="btn btn--ghost btn--small" onClick={selected ? () => setSelected(null) : onBack}>
          ← Volver
        </button>
        <div className="brand brand--small">{selected ? "Recorrido" : "Mis recorridos"}</div>
      </header>

      {!selected ? (
        list.status === "loading" ? (
          <p className="muted">Cargando jornadas…</p>
        ) : list.status === "error" ? (
          <LoadError message={list.message} onRetry={reloadList} />
        ) : list.data.length === 0 ? (
          <p className="muted">Todavía no hay jornadas registradas.</p>
        ) : (
          <ul className="stack list">
            {list.data.map((w) => (
              <li key={w.id}>
                <button className="card list__item" onClick={() => setSelected(w.id)}>
                  <strong>{new Date(w.started_at).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })}</strong>
                  <span className="muted">
                    {time(w.started_at)} – {w.ended_at ? time(w.ended_at) : "en curso"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : track.status === "loading" ? (
        <p className="muted">Cargando recorrido…</p>
      ) : track.status === "error" ? (
        <LoadError message={track.message} onRetry={reloadTrack} />
      ) : (
        <TrackDetail track={track.data} styleUrl={app.config.mapStyleUrl} />
      )}
    </main>
  );
}

function TrackDetail({ track, styleUrl }: { track: WorkdayTrack; styleUrl: string }) {
  return (
    <>
      <section className="card stats" aria-label="Resumen del recorrido">
        <div><strong>{formatDistance(track.stats.distance_m)}</strong><span className="muted">recorridos</span></div>
        <div><strong>{track.stats.point_count}</strong><span className="muted">puntos</span></div>
        <div><strong>{track.stats.gap_count}</strong><span className="muted">{track.stats.gap_count === 1 ? "hueco" : "huecos"}</span></div>
      </section>
      <Suspense fallback={<div className="map map--loading">Cargando mapa…</div>}>
        <TrackMap track={track} styleUrl={styleUrl} />
      </Suspense>
      {track.gaps.length > 0 ? (
        <section className="card" aria-label="Huecos del recorrido">
          <h3>Huecos (sin datos de ubicación)</h3>
          <ul className="log">
            {track.gaps.map((g) => (
              <li key={g.from_at}>
                {time(g.from_at)} – {time(g.to_at)} · {formatDuration(g.seconds)}
              </li>
            ))}
          </ul>
          <p className="muted">
            En la versión web, la ubicación se corta con la app cerrada o la pantalla bloqueada. Esos tramos quedan como
            huecos.
          </p>
        </section>
      ) : null}
    </>
  );
}
