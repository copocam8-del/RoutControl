import {
  distanceTo,
  filterStops,
  formatDistance,
  mapStops,
  routeLegs,
  STOP_STATE_LABEL,
  type StopState,
} from "@routcontrol/domain";
import { Button, EmptyState, LoadingState } from "@routcontrol/ui";
import type { StopsMapHandle } from "@routcontrol/ui/map";
import { lazy, Suspense, useMemo, useRef, useState } from "react";

import { nextPackage } from "../delivery/deliveries";
import { loadMapModule } from "../map/offlineMap";
import { useApp, useStore } from "./hooks";
import { NavigateChoices, NavigateLink, StatusBadge } from "./PackagesScreen";
import { useMyLocation } from "./useMyLocation";

// Con lo guardado para usar sin conexión (ADR-018): las teselas de la zona salen del teléfono.
const StopsMap = lazy(() => loadMapModule().then((m) => ({ default: m.StopsMap })));

const LEGEND: StopState[] = ["pending", "delivered", "failed", "second"];
/** Lo que tapa la tarjeta de abajo cuando hay una parada elegida (para encuadrar arriba). */
const SHEET_PX = 230;
/** La barra inferior flotante (72 px + márgenes) y la leyenda, cuando no hay tarjeta. */
const NAV_PX = 108;
const LEGEND_PX = 90;

/**
 * Mapa con las entregas del día (ADR-019): un círculo numerado por domicilio (Ruta.dc.html) con su número de parada y el
 * color de su estado, la línea de la ruta si está armada y mi ubicación (con la jornada en curso).
 * Al tocar una parada sube la tarjeta con la dirección, el destinatario, el estado y la distancia.
 */
export function MapScreen({ onOpenPackage }: { onOpenPackage(id: string): void }) {
  const app = useApp();
  const state = useStore(app.deliveries);
  const { location: me, reason } = useMyLocation();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [selected, setSelectedId] = useState<string | null>(null);
  const [choosingNav, setChoosingNav] = useState(false);
  const setSelected = (id: string | null) => {
    setSelectedId(id);
    setChoosingNav(false);
  };
  const map = useRef<StopsMapHandle>(null);

  const all = useMemo(() => mapStops(state.packages, state.route), [state.packages, state.route]);
  const stops = useMemo(() => filterStops(all, filter), [all, filter]);
  const legs = useMemo(() => routeLegs(state.route, state.packages), [state.route, state.packages]);
  const pendingCount = filterStops(all, "pending").length;
  // La misma próxima parada que muestra Inicio.
  const nextId = useMemo(() => nextPackage(state.packages, state.route, state.activeVisit?.package_id)?.id ?? null, [state.packages, state.route, state.activeVisit]);
  const stop = selected ? stops.find((s) => s.id === selected) : undefined;
  const pkg = stop ? state.packages.find((p) => p.id === stop.id) : undefined;
  const distance = stop ? distanceTo(me, stop) : null;
  const unlocated = state.packages.filter((p) => !p.address.location).length;

  return (
    <main className="map-screen">
      <h1 className="rc-visually-hidden">Mapa de entregas</h1>
      <div className="map-screen__map">
        {state.status === "loading" ? (
          <LoadingState label="Cargando tus paquetes…" />
        ) : all.length === 0 ? (
          <div className="map-screen__empty">
            <EmptyState
              title={state.packages.length ? "Tus paquetes no tienen la dirección ubicada en el mapa." : "No tenés paquetes asignados."}
              description={state.packages.length ? "Abrilos desde Paquetes para navegar con la dirección." : "Cuando tu empresa te asigne paquetes, aparecen acá."}
            />
          </div>
        ) : (
          <Suspense fallback={<LoadingState label="Cargando mapa…" />}>
            <StopsMap
              stops={stops}
              legs={legs}
              me={me}
              selectedId={stop ? stop.id : null}
              nextId={nextId}
              onSelect={setSelected}
              source={app.config.map}
              bottomPadding={NAV_PX + (stop ? SHEET_PX : LEGEND_PX)}
              controlRef={map}
              label={`Mapa con ${stops.length} ${stops.length === 1 ? "parada" : "paradas"}`}
            />
          </Suspense>
        )}
      </div>

      {all.length ? (
        <>
          <div className="map-screen__top">
            <div className="map-chips" role="group" aria-label="Qué paradas ver">
              <button type="button" className="map-chip" aria-pressed={filter === "pending"} onClick={() => setFilter("pending")}>
                Pendientes · {pendingCount}
              </button>
              <button type="button" className="map-chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                Todas · {all.length}
              </button>
            </div>
            {unlocated ? (
              <span className="map-chip map-chip--note">
                {unlocated === 1 ? "1 paquete sin ubicación" : `${unlocated} paquetes sin ubicación`}
              </span>
            ) : null}
          </div>

          <div className={`map-fabs${stop ? " map-fabs--raised" : ""}`}>
            <button
              type="button"
              className="map-fab"
              aria-label="Centrar en mi ubicación"
              title={me ? "Centrar en mi ubicación" : reason === "no_workday" ? "Tu ubicación se ve con la jornada iniciada" : "Buscando tu ubicación…"}
              disabled={!me}
              onClick={() => me && map.current?.centerOn(me.lat, me.lng)}
            >
              <IconLocate />
            </button>
            <button type="button" className="map-fab" aria-label="Ver todas las paradas" onClick={() => map.current?.fitAll()}>
              <IconFit />
            </button>
          </div>

          {stop && pkg ? (
            <section className="stop-card map-sheet" aria-label={`Parada ${stop.n}`}>
              <div className="stop-card__head">
                <span className="rc-eyebrow">Parada {stop.n}</span>
                <StatusBadge status={pkg.status} />
              </div>
              <div className="stop-card__who">
                <span className={`map-sheet__n map-sheet__n--${stop.state}`} aria-hidden="true">
                  {stop.n}
                </span>
                <div>
                  <div className="stop-card__address">{pkg.address.raw_text}</div>
                  <div className="rc-muted">
                    {[pkg.recipient_name || "Sin destinatario", distance !== null ? formatDistance(distance) : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
              <div className="map-sheet__actions">
                <Button onClick={() => onOpenPackage(pkg.id)}>Ver ficha</Button>
                <NavigateLink pkg={pkg} variant="button" choosing={choosingNav} onChoosing={setChoosingNav} />
              </div>
              {choosingNav ? <NavigateChoices pkg={pkg} onDone={() => setChoosingNav(false)} /> : null}
              <button type="button" className="map-sheet__close" aria-label="Cerrar" onClick={() => setSelected(null)}>
                ×
              </button>
            </section>
          ) : (
            <ul className="map-legend" aria-label="Referencias">
              {LEGEND.map((s) => (
                <li key={s} className="map-chip map-chip--legend">
                  <span className={`map-legend__dot map-legend__dot--${s}`} aria-hidden="true" />
                  {STOP_STATE_LABEL[s]}
                </li>
              ))}
              {nextId ? (
                <li className="map-chip map-chip--legend">
                  <span className="map-legend__dot map-legend__dot--next" aria-hidden="true" />
                  Próxima
                </li>
              ) : null}
              {reason === "no_workday" ? <li className="map-chip map-chip--legend">Tu ubicación se ve con la jornada iniciada</li> : null}
            </ul>
          )}
        </>
      ) : null}
    </main>
  );
}

function IconLocate() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

function IconFit() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
    </svg>
  );
}
