/**
 * Mapa del recorrido con MapLibre. Se carga aparte (import dinámico) para no agrandar la carga
 * inicial de la app, que se usa en la calle con datos móviles.
 *
 * Capas: tramos del recorrido (línea continua), huecos (línea punteada entre los extremos: ahí NO
 * hay datos), puntos registrados y los eventos de inicio y fin.
 */
import { gapLines, trackBounds, type WorkdayTrack } from "@routcontrol/domain";
import { useEffect, useRef, useState } from "react";

const COLORS = { route: "#16335C", gap: "#F59E0B", point: "#16335C", start: "#16A34A", end: "#DC2626" };

export function TrackMap({ track, styleUrl }: { track: WorkdayTrack; styleUrl: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let map: import("maplibre-gl").Map | null = null;

    void (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (disposed || !container.current) return;
        const bounds = trackBounds(track);
        map = new maplibre.Map({
          container: container.current,
          style: styleUrl,
          ...(bounds ? { bounds, fitBoundsOptions: { padding: 40, maxZoom: 17 } } : { center: [-58.38, -34.6], zoom: 11 }),
          attributionControl: { compact: true },
        });
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        map.on("load", () => {
          if (!map) return;
          map.addSource("segments", { type: "geojson", data: track.segments });
          map.addSource("gaps", { type: "geojson", data: gapLines(track) });
          map.addSource("points", { type: "geojson", data: track.points });
          map.addLayer({
            id: "gaps",
            type: "line",
            source: "gaps",
            paint: { "line-color": COLORS.gap, "line-width": 3, "line-dasharray": [1, 2] },
          });
          map.addLayer({
            id: "segments",
            type: "line",
            source: "segments",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": COLORS.route, "line-width": 4 },
          });
          map.addLayer({
            id: "points",
            type: "circle",
            source: "points",
            filter: ["!=", ["get", "source"], "EVENT"],
            paint: { "circle-radius": 3, "circle-color": COLORS.point, "circle-stroke-color": "#fff", "circle-stroke-width": 1 },
          });
          map.addLayer({
            id: "events",
            type: "circle",
            source: "points",
            filter: ["==", ["get", "source"], "EVENT"],
            paint: {
              "circle-radius": 8,
              "circle-color": ["match", ["get", "event"], "workday_end", COLORS.end, COLORS.start],
              "circle-stroke-color": "#fff",
              "circle-stroke-width": 2,
            },
          });
        });
      } catch {
        if (!disposed) setError("No se pudo cargar el mapa (¿sin conexión?). Los datos del recorrido están abajo.");
      }
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [track, styleUrl]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" role="img" aria-label="Mapa del recorrido" />
      {error ? <p className="alert alert--error">{error}</p> : null}
      <ul className="legend">
        <li><span className="legend__line" style={{ background: COLORS.route }} /> Recorrido registrado</li>
        <li><span className="legend__line legend__line--dashed" style={{ borderColor: COLORS.gap }} /> Hueco (sin datos)</li>
        <li><span className="legend__dot" style={{ background: COLORS.start }} /> Inicio · <span className="legend__dot" style={{ background: COLORS.end }} /> Fin</li>
      </ul>
    </div>
  );
}
