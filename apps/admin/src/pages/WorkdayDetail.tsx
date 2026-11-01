import type { WorkdayTrack } from "@routcontrol/domain";
import {
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
import { lazy, Suspense, useCallback } from "react";

import { describeLoadError, useAdmin } from "../adminApp";
import { useNow } from "../hooks";
import { PageTitle } from "../Layout";
import { href } from "../router";
import { WorkdayStatus } from "../WorkdayTable";

// MapLibre (~1 MB) se carga recién al abrir un recorrido.
const TrackMap = lazy(() => import("@routcontrol/ui/map").then((m) => ({ default: m.TrackMap })));

const describe = (e: unknown) => describeLoadError(e, "el recorrido");

/** Recorrido de una jornada: resumen, mapa con los huecos marcados y lista de huecos. */
export function WorkdayDetail({ id }: { id: string }) {
  const { api, config } = useAdmin();
  const load = useCallback(() => api.workdayTrack(id), [api, id]);
  const [state, reload] = useLoad<WorkdayTrack>(load, describe);
  const now = useNow(30_000);

  return (
    <Loadable state={state} loadingLabel="Cargando recorrido…" onRetry={reload}>
      {(track) => {
        const w = track.workday;
        const end = w.ended_at ? Date.parse(w.ended_at) : now;
        return (
          <div className="rc-stack">
            <PageTitle
              title={w.driver.name}
              description={
                <>
                  {formatDay(w.started_at)} · {formatTime(w.started_at)} – {w.ended_at ? formatTime(w.ended_at) : "en curso"}{" "}
                  <WorkdayStatus workday={w} now={now} />
                </>
              }
              actions={
                <a className="rc-btn rc-btn--secondary rc-btn--sm" href={href({ name: "workdays", date: w.date })}>
                  ← Jornadas del día
                </a>
              }
            />
            <Stats
              label="Resumen del recorrido"
              items={[
                { label: "recorridos", value: formatDistance(track.stats.distance_m) },
                { label: "duración", value: formatDuration((end - Date.parse(w.started_at)) / 1000) },
                { label: "puntos", value: track.stats.point_count },
                { label: track.stats.gap_count === 1 ? "hueco" : "huecos", value: track.stats.gap_count },
                { label: "sin datos", value: formatDuration(track.stats.gap_seconds) },
              ]}
            />
            {track.stats.point_count === 0 ? (
              <Card label="Mapa">
                <EmptyState
                  title="Esta jornada no tiene ubicaciones registradas."
                  description="Puede pasar si la app estuvo cerrada o sin permiso de ubicación durante toda la jornada."
                  action={<Button variant="secondary" onClick={reload}>Volver a consultar</Button>}
                />
              </Card>
            ) : (
              <Card label="Mapa">
                <Suspense fallback={<LoadingState label="Cargando mapa…" />}>
                  <TrackMap track={track} styleUrl={config.mapStyleUrl} />
                </Suspense>
              </Card>
            )}
            {track.gaps.length > 0 ? (
              <Card title="Huecos (sin datos de ubicación)" label="Huecos del recorrido">
                <table className="rc-table">
                  <thead>
                    <tr>
                      <th scope="col">Desde</th>
                      <th scope="col">Hasta</th>
                      <th scope="col">Duración</th>
                    </tr>
                  </thead>
                  <tbody>
                    {track.gaps.map((g) => (
                      <tr key={g.from_at}>
                        <td className="rc-num">{formatTime(g.from_at)}</td>
                        <td className="rc-num">{formatTime(g.to_at)}</td>
                        <td className="rc-num">{formatDuration(g.seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="rc-muted" style={{ marginBottom: 0 }}>
                  {w.tracking_mode === "EVENTS_ONLY"
                    ? "Jornada hecha con la app web: la ubicación se registra solo con la app abierta. Los huecos son esperables y no se comparan con jornadas de recorrido continuo (§4.2)."
                    : "Tramos sin datos: sin señal, app cerrada o permiso revocado."}
                </p>
              </Card>
            ) : null}
          </div>
        );
      }}
    </Loadable>
  );
}
