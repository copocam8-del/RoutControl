import type { WorkdayTrack, WorkdayWithDriver } from "@routcontrol/domain";
import {
  Badge,
  Button,
  EmptyState,
  formatDistance,
  formatDuration,
  formatLongDate,
  formatSpan,
  formatTime,
  IconAlert,
  IconArrowLeft,
  IconMap,
  ListItem,
  Loadable,
  LoadingState,
  Stats,
  useLoad,
} from "@routcontrol/ui";
import type { MapSource } from "@routcontrol/ui/map";
import { lazy, Suspense, useCallback } from "react";

import { ApiError, NetworkError } from "../api/client";
import { useApp, useNow } from "./hooks";
import { loadMapModule } from "../map/offlineMap";

// MapLibre (~1 MB) se descarga recién al abrir un recorrido.
// Con el mapa sin conexión registrado: las teselas guardadas salen del teléfono (ADR-018).
const TrackMap = lazy(() => loadMapModule().then((m) => ({ default: m.TrackMap })));

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

/** "Recorridos": las jornadas propias; cada una abre "Mi recorrido" (Recorrido.dc.html). */
export function TrackScreen({ selected, onSelect, onHome }: { selected: string | null; onSelect(id: string | null): void; onHome(): void }) {
  const app = useApp();
  const loadList = useCallback(() => app.api.listWorkdays(), [app]);
  const [list, reloadList] = useLoad<WorkdayWithDriver[]>(selected ? null : loadList, listError);

  if (selected) return <TrackDetailScreen id={selected} onBack={() => onSelect(null)} onHome={onHome} />;

  return (
    <main className="screen screen--tabs">
      <header className="screen-header">
        <h1 className="screen-title">Mis recorridos</h1>
        <p className="rc-muted screen-subtitle">Tus jornadas y el recorrido registrado en cada una.</p>
      </header>
      <div className="screen-body">
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
            <ul className="items">
              {items.map((w) => (
                <li key={w.id}>
                  <ListItem
                    tone={w.ended_at ? "info" : "ok"}
                    icon={<IconMap />}
                    title={formatLongDate(w.started_at)}
                    detail={`${formatTime(w.started_at)} a ${w.ended_at ? formatTime(w.ended_at) : "ahora"}`}
                    trailing={w.ended_at ? <Badge tone="neutral">Finalizada</Badge> : <Badge tone="success">En curso</Badge>}
                    onClick={() => onSelect(w.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Loadable>
      </div>
    </main>
  );
}

function TrackDetailScreen({ id, onBack, onHome }: { id: string; onBack(): void; onHome(): void }) {
  const app = useApp();
  const loadTrack = useCallback(() => app.api.workdayTrack(id), [app, id]);
  const [track, reloadTrack] = useLoad<WorkdayTrack>(loadTrack, trackError);
  const workday = track.status === "ready" ? track.data.workday : null;

  return (
    <main className="screen">
      <header className="detail-header">
        <button type="button" className="rc-icon-btn" aria-label="Volver" onClick={onBack}>
          <IconArrowLeft />
        </button>
        <div className="detail-header__text">
          <h1>Mi recorrido</h1>
          {workday ? (
            <span className="rc-muted">
              {formatLongDate(workday.started_at)} · {formatTime(workday.started_at)} a{" "}
              {workday.ended_at ? formatTime(workday.ended_at) : "ahora"}
            </span>
          ) : null}
        </div>
      </header>
      <div className="screen-body">
        <Loadable state={track} loadingLabel="Cargando recorrido…" onRetry={reloadTrack}>
          {(data) => <TrackDetail track={data} source={app.config.map} />}
        </Loadable>
        <Button variant="secondary" block className="push-bottom" onClick={onHome}>
          Volver al inicio
        </Button>
      </div>
    </main>
  );
}

function TrackDetail({ track, source }: { track: WorkdayTrack; source: MapSource }) {
  const now = useNow(30_000);
  const live = track.workday.ended_at === null;
  if (track.stats.point_count === 0) {
    return (
      <EmptyState
        title="Esta jornada no tiene ubicaciones registradas."
        description="Puede pasar si la app estuvo cerrada o sin permiso de ubicación durante toda la jornada."
      />
    );
  }
  const gaps = track.gaps;
  return (
    <>
      <Suspense fallback={<LoadingState label="Cargando mapa…" />}>
        <TrackMap track={track} source={source} live={live} />
      </Suspense>
      <Stats
        label="Resumen del recorrido"
        items={[
          { label: "Duración", value: formatSpan(track.workday.started_at, track.workday.ended_at ?? now) },
          { label: "Distancia", value: formatDistance(track.stats.distance_m) },
        ]}
      />
      {gaps.length > 0 ? (
        <section className="gap-card" aria-label="Huecos del recorrido">
          <span className="rc-item__icon rc-item__icon--gap" aria-hidden="true">
            <IconAlert />
          </span>
          <div className="gap-card__body">
            <div className="gap-card__title">
              {gaps.length === 1
                ? `1 tramo sin datos · ${formatTime(gaps[0]!.from_at)} a ${formatTime(gaps[0]!.to_at)}`
                : `${gaps.length} tramos sin datos · ${formatDuration(track.stats.gap_seconds)} en total`}
            </div>
            {gaps.length > 1 ? (
              <ul className="gap-card__list">
                {gaps.map((g) => (
                  <li key={g.from_at}>
                    {formatTime(g.from_at)} a {formatTime(g.to_at)} · {formatDuration(g.seconds)}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="gap-card__duration">{formatDuration(gaps[0]!.seconds)} sin ubicación</div>
            )}
            <p>
              En esos tramos la app estuvo cerrada o con la pantalla bloqueada. En la app web el GPS se pausa en ese caso; la app
              de las tiendas lo va a registrar completo.
            </p>
          </div>
        </section>
      ) : null}
    </>
  );
}
