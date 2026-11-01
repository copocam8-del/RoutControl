import type { WorkdayTrack } from "@routcontrol/domain";
import {
  Button,
  EmptyState,
  formatDistance,
  formatDuration,
  formatLongDate,
  formatTime,
  IconAlert,
  IconArrowLeft,
  Loadable,
  LoadingState,
  Stats,
  useLoad,
} from "@routcontrol/ui";
import { lazy, Suspense, useCallback } from "react";

import { describeLoadError, useAdmin } from "../adminApp";
import { useNow } from "../hooks";
import { DemoChip, PageTitle } from "../Layout";
import { href } from "../router";
import { WorkdayBadge as WorkdayStatus } from "./Workdays";

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
          <>
            <PageTitle
              back={
                <a className="rc-icon-btn" href={href({ name: "workdays", date: w.date })} aria-label="Volver a las jornadas del día">
                  <IconArrowLeft />
                </a>
              }
              eyebrow={formatLongDate(w.started_at)}
              title={w.driver.name}
              description={
                <>
                  {formatTime(w.started_at)} a {w.ended_at ? formatTime(w.ended_at) : "ahora"} <WorkdayStatus workday={w} now={now} />
                </>
              }
              actions={<DemoChip />}
            />
            <Stats
              label="Resumen del recorrido"
              items={[
                { label: "Distancia", value: formatDistance(track.stats.distance_m) },
                { label: "Duración", value: formatDuration((end - Date.parse(w.started_at)) / 1000) },
                { label: "Ubicaciones", value: track.stats.point_count },
                { label: track.stats.gap_count === 1 ? "Tramo sin datos" : "Tramos sin datos", value: track.stats.gap_count, tone: track.stats.gap_count ? "warn" : undefined },
                { label: "Tiempo sin datos", value: formatDuration(track.stats.gap_seconds) },
              ]}
            />
            {track.stats.point_count === 0 ? (
              <section className="panel-card" aria-label="Mapa">
                <EmptyState
                  title="Esta jornada no tiene ubicaciones registradas."
                  description="Puede pasar si la app estuvo cerrada o sin permiso de ubicación durante toda la jornada."
                  action={
                    <Button variant="secondary" onClick={reload}>
                      Volver a consultar
                    </Button>
                  }
                />
              </section>
            ) : (
              <section aria-label="Mapa">
                <Suspense fallback={<LoadingState label="Cargando mapa…" />}>
                  <TrackMap track={track} source={config.map} height={460} live={w.ended_at === null} />
                </Suspense>
              </section>
            )}
            {track.gaps.length > 0 ? (
              <section className="gap-card" aria-label="Huecos del recorrido">
                <span className="rc-item__icon rc-item__icon--gap" aria-hidden="true">
                  <IconAlert />
                </span>
                <div className="gap-card__body">
                  <h2 className="gap-card__title">
                    {track.gaps.length === 1 ? "1 tramo sin datos" : `${track.gaps.length} tramos sin datos`} ·{" "}
                    {formatDuration(track.stats.gap_seconds)}
                  </h2>
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
                  <p>
                    {w.tracking_mode === "EVENTS_ONLY"
                      ? "Jornada hecha con la app web: la ubicación se registra solo con la app abierta. Los huecos son esperables y no se comparan con jornadas de recorrido continuo (§4.2)."
                      : "Tramos sin datos: sin señal, app cerrada o permiso revocado."}
                  </p>
                </div>
              </section>
            ) : null}
          </>
        );
      }}
    </Loadable>
  );
}
