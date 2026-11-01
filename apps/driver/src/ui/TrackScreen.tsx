import type { WorkdayTrack, WorkdayWithDriver } from "@routcontrol/domain";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  formatDay,
  formatDistance,
  formatDuration,
  formatTime,
  Loadable,
  LoadingState,
  Stats,
  useLoad,
} from "@routcontrol/ui";
import { lazy, Suspense, useCallback, useState } from "react";

import { ApiError, NetworkError } from "../api/client";
import { useApp } from "./hooks";

// MapLibre (~1 MB) se descarga recién al abrir un recorrido.
const TrackMap = lazy(() => import("@routcontrol/ui/map").then((m) => ({ default: m.TrackMap })));

export function describeLoadError(error: unknown, what: string): string {
  if (error instanceof NetworkError) return `Sin conexión con el servidor: no se pudo cargar ${what}.`;
  if (error instanceof ApiError) {
    if (error.status === 404) return `No se encontró ${what}.`;
    if (error.status === 401 || error.status === 403) return "Tu sesión venció. Volvé a ingresar.";
    return `No se pudo cargar ${what} (error ${error.status}).`;
  }
  return `No se pudo cargar ${what}.`;
}

const listError = (e: unknown) => describeLoadError(e, "las jornadas");
const trackError = (e: unknown) => describeLoadError(e, "el recorrido");

/** "Mis recorridos": las jornadas propias y el recorrido de cada una, con los huecos marcados. */
export function TrackScreen({ onBack }: { onBack(): void }) {
  const app = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const loadList = useCallback(() => app.api.listWorkdays(), [app]);
  const loadTrack = useCallback(() => app.api.workdayTrack(selected!), [app, selected]);
  const [list, reloadList] = useLoad<WorkdayWithDriver[]>(loadList, listError);
  const [track, reloadTrack] = useLoad<WorkdayTrack>(selected ? loadTrack : null, trackError);

  return (
    <main className="screen">
      <header className="topbar">
        <Button variant="ghost" size="sm" onClick={selected ? () => setSelected(null) : onBack}>
          ← Volver
        </Button>
        <h1 style={{ fontSize: 20 }}>{selected ? "Recorrido" : "Mis recorridos"}</h1>
      </header>

      {!selected ? (
        <Loadable
          state={list}
          loadingLabel="Cargando jornadas…"
          onRetry={reloadList}
          isEmpty={(items) => items.length === 0}
          empty={
            <EmptyState
              title="Todavía no hay jornadas registradas."
              description="Cuando inicies y finalices una jornada, vas a poder ver su recorrido acá."
            />
          }
        >
          {(items) => (
            <ul className="rc-stack list">
              {items.map((w) => (
                <li key={w.id}>
                  <button className="rc-card list__item" onClick={() => setSelected(w.id)}>
                    <span className="list__when">
                      <span className="list__day">{formatDay(w.started_at)}</span>
                      <span className="rc-muted">
                        {formatTime(w.started_at)} – {w.ended_at ? formatTime(w.ended_at) : "en curso"}
                      </span>
                    </span>
                    {w.ended_at ? <Badge tone="neutral">Finalizada</Badge> : <Badge tone="accent">En curso</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Loadable>
      ) : (
        <Loadable state={track} loadingLabel="Cargando recorrido…" onRetry={reloadTrack}>
          {(data) => <TrackDetail track={data} styleUrl={app.config.mapStyleUrl} />}
        </Loadable>
      )}
    </main>
  );
}

function TrackDetail({ track, styleUrl }: { track: WorkdayTrack; styleUrl: string }) {
  if (track.stats.point_count === 0) {
    return (
      <EmptyState
        title="Esta jornada no tiene ubicaciones registradas."
        description="Puede pasar si la app estuvo cerrada o sin permiso de ubicación durante toda la jornada."
      />
    );
  }
  return (
    <>
      <Stats
        label="Resumen del recorrido"
        items={[
          { label: "recorridos", value: formatDistance(track.stats.distance_m) },
          { label: "puntos", value: track.stats.point_count },
          { label: track.stats.gap_count === 1 ? "hueco" : "huecos", value: track.stats.gap_count },
        ]}
      />
      <Suspense fallback={<LoadingState label="Cargando mapa…" />}>
        <TrackMap track={track} styleUrl={styleUrl} />
      </Suspense>
      {track.gaps.length > 0 ? (
        <Card title="Huecos (sin datos de ubicación)" label="Huecos del recorrido">
          <ul className="log">
            {track.gaps.map((g) => (
              <li key={g.from_at}>
                {formatTime(g.from_at)} – {formatTime(g.to_at)} · {formatDuration(g.seconds)}
              </li>
            ))}
          </ul>
          <p className="rc-muted" style={{ marginBottom: 0 }}>
            En la versión web, la ubicación se corta con la app cerrada o la pantalla bloqueada. Esos tramos quedan como
            huecos.
          </p>
        </Card>
      ) : null}
    </>
  );
}
