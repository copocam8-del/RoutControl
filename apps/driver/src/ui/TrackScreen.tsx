import type { WorkdayTrack, WorkdayWithDriver } from "@routcontrol/domain";
import { lazy, Suspense, useEffect, useState } from "react";

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

/** "Mis recorridos": las jornadas propias y el recorrido de cada una, con los huecos marcados. */
export function TrackScreen({ onBack }: { onBack(): void }) {
  const app = useApp();
  const [workdays, setWorkdays] = useState<WorkdayWithDriver[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [track, setTrack] = useState<WorkdayTrack | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    app.api
      .listWorkdays()
      .then(setWorkdays)
      .catch(() => setError("No se pudieron cargar las jornadas. Revisá la conexión."));
  }, [app]);

  useEffect(() => {
    if (!selected) return;
    setTrack(null);
    app.api
      .workdayTrack(selected)
      .then(setTrack)
      .catch(() => setError("No se pudo cargar el recorrido."));
  }, [app, selected]);

  return (
    <main className="screen">
      <header className="topbar">
        <button className="btn btn--ghost btn--small" onClick={selected ? () => setSelected(null) : onBack}>
          ← Volver
        </button>
        <div className="brand brand--small">{selected ? "Recorrido" : "Mis recorridos"}</div>
      </header>

      {error ? <p className="alert alert--error" role="alert">{error}</p> : null}

      {!selected ? (
        workdays === null ? (
          <p className="muted">Cargando…</p>
        ) : workdays.length === 0 ? (
          <p className="muted">Todavía no hay jornadas registradas.</p>
        ) : (
          <ul className="stack list">
            {workdays.map((w) => (
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
      ) : track === null ? (
        <p className="muted">Cargando recorrido…</p>
      ) : (
        <>
          <section className="card stats" aria-label="Resumen del recorrido">
            <div><strong>{formatDistance(track.stats.distance_m)}</strong><span className="muted">recorridos</span></div>
            <div><strong>{track.stats.point_count}</strong><span className="muted">puntos</span></div>
            <div><strong>{track.stats.gap_count}</strong><span className="muted">{track.stats.gap_count === 1 ? "hueco" : "huecos"}</span></div>
          </section>
          <Suspense fallback={<div className="map map--loading">Cargando mapa…</div>}>
            <TrackMap track={track} styleUrl={app.config.mapStyleUrl} />
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
      )}
    </main>
  );
}
