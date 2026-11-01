/**
 * Mapa del recorrido de una jornada (MapLibre). Lo usan la PWA ("Mis recorridos") y el panel.
 *
 * Se importa aparte (`@routcontrol/ui/map`) y conviene cargarlo con `lazy()`: MapLibre pesa ~1 MB
 * y no tiene que ir en la carga inicial.
 *
 * Capas: tramos registrados (violeta, continua), huecos (naranja, punteada: ahí NO hay datos),
 * puntos (azul), inicio (verde) y fin (rojo).
 */
import { gapLines, trackBounds, type WorkdayTrack } from "@routcontrol/domain";
import { useEffect, useRef, useState } from "react";

import { color } from "../tokens";

export const MAP_COLORS = {
  route: color.violet700,
  gap: color.warning,
  point: color.blue700,
  start: color.success,
  end: color.danger,
} as const;

export function TrackMap({ track, styleUrl }: { track: WorkdayTrack; styleUrl: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let map: import("maplibre-gl").Map | null = null;
    setFailed(false);

    void (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (disposed || !container.current) return;
        const bounds = trackBounds(track);
        map = new maplibre.Map({
          container: container.current,
          style: styleUrl,
          ...(bounds ? { bounds, fitBoundsOptions: { padding: 48, maxZoom: 17 } } : { center: [-58.38, -34.6], zoom: 11 }),
          attributionControl: { compact: true },
        });
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        map.on("error", (event) => {
          // El estilo o las teselas no cargaron (sin conexión, proveedor caído).
          if (!map?.isStyleLoaded() && !disposed) {
            console.warn("Mapa:", event.error);
            setFailed(true);
          }
        });
        map.on("load", () => {
          if (!map) return;
          map.addSource("segments", { type: "geojson", data: track.segments });
          map.addSource("gaps", { type: "geojson", data: gapLines(track) });
          map.addSource("points", { type: "geojson", data: track.points });
          map.addLayer({
            id: "gaps",
            type: "line",
            source: "gaps",
            paint: { "line-color": MAP_COLORS.gap, "line-width": 3, "line-dasharray": [1, 2] },
          });
          map.addLayer({
            id: "segments",
            type: "line",
            source: "segments",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": MAP_COLORS.route, "line-width": 5 },
          });
          map.addLayer({
            id: "points",
            type: "circle",
            source: "points",
            filter: ["!=", ["get", "source"], "EVENT"],
            paint: { "circle-radius": 3.5, "circle-color": MAP_COLORS.point, "circle-stroke-color": "#fff", "circle-stroke-width": 1 },
          });
          map.addLayer({
            id: "events",
            type: "circle",
            source: "points",
            filter: ["==", ["get", "source"], "EVENT"],
            paint: {
              "circle-radius": 9,
              "circle-color": ["match", ["get", "event"], "workday_end", MAP_COLORS.end, MAP_COLORS.start],
              "circle-stroke-color": "#fff",
              "circle-stroke-width": 3,
            },
          });
        });
      } catch (error) {
        console.warn("Mapa:", error);
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [track, styleUrl, attempt]);

  return (
    <div className="rc-stack">
      {failed ? (
        <div className="rc-state">
          <p className="rc-alert rc-alert--error" role="alert" style={{ margin: 0 }}>
            No se pudo cargar el mapa (¿sin conexión?). Los datos del recorrido siguen abajo.
          </p>
          <button type="button" className="rc-btn rc-btn--secondary" onClick={() => setAttempt((n) => n + 1)}>
            Reintentar
          </button>
        </div>
      ) : null}
      <div ref={container} className="rc-map" role="img" aria-label="Mapa del recorrido" hidden={failed} />
      <ul className="rc-legend">
        <li>
          <span className="rc-legend__line" style={{ borderColor: MAP_COLORS.route }} /> Recorrido registrado
        </li>
        <li>
          <span className="rc-legend__line rc-legend__line--dashed" style={{ borderColor: MAP_COLORS.gap }} /> Hueco (sin datos)
        </li>
        <li>
          <span className="rc-legend__dot" style={{ background: MAP_COLORS.start }} /> Inicio
        </li>
        <li>
          <span className="rc-legend__dot" style={{ background: MAP_COLORS.end }} /> Fin
        </li>
      </ul>
    </div>
  );
}
