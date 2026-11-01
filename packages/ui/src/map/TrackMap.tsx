/**
 * Mapas (MapLibre), en el tema oscuro de las maquetas. Los usan la PWA ("Mi recorrido") y el panel.
 *
 * Se importa aparte (`@routcontrol/ui/map`) y conviene cargarlo con `lazy()`: MapLibre pesa ~1 MB
 * y no tiene que ir en la carga inicial.
 *
 * - `TrackMap`: recorrido de una jornada. Tramos registrados en violeta continuo, huecos en naranja
 *   punteado (ahí NO hay datos), inicio en verde y fin (o última ubicación) en blanco con borde violeta.
 * - `PositionsMap`: última ubicación de cada repartidor (panel). Violeta = con señal; amarillo = sin
 *   señal reciente.
 */
import { gapLines, trackBounds, type WorkdayTrack } from "@routcontrol/domain";
import { useEffect, useRef, useState } from "react";

import { color } from "../tokens";

export const MAP_COLORS = {
  route: color.route,
  gap: color.gap,
  point: color.violet300,
  start: color.success,
  end: color.white,
  endStroke: color.primary,
  live: color.primary,
  stale: color.warning,
} as const;

type MapLibre = typeof import("maplibre-gl");
type MapInstance = import("maplibre-gl").Map;

/** Crea el mapa y maneja la carga diferida, los errores y "Reintentar". */
function useMap(
  styleUrl: string,
  setup: (maplibre: MapLibre, map: MapInstance) => void,
  options: (maplibre: MapLibre) => Partial<import("maplibre-gl").MapOptions>,
  deps: unknown[],
) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let map: MapInstance | null = null;
    setFailed(false);

    void (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (disposed || !container.current) return;
        map = new maplibre.Map({
          container: container.current,
          style: styleUrl,
          attributionControl: { compact: true },
          ...options(maplibre),
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
          if (map) setup(maplibre, map);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl, attempt, ...deps]);

  return { container, failed, retry: () => setAttempt((n) => n + 1) };
}

function MapFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rc-state rc-map-failed">
      <p className="rc-alert rc-alert--error" role="alert" style={{ margin: 0 }}>
        No se pudo cargar el mapa (¿sin conexión?). Los datos siguen abajo.
      </p>
      <button type="button" className="rc-btn rc-btn--secondary" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}

export function TrackMap({
  track,
  styleUrl,
  height = 360,
  /** Jornada en curso: el último punto es "Ahora", no "Fin". */
  live = false,
}: {
  track: WorkdayTrack;
  styleUrl: string;
  height?: number;
  live?: boolean;
}) {
  const { container, failed, retry } = useMap(
    styleUrl,
    (_maplibre, map) => {
      map.addSource("segments", { type: "geojson", data: track.segments });
      map.addSource("gaps", { type: "geojson", data: gapLines(track) });
      map.addSource("points", { type: "geojson", data: track.points });
      map.addLayer({
        id: "gaps",
        type: "line",
        source: "gaps",
        layout: { "line-cap": "round" },
        paint: { "line-color": MAP_COLORS.gap, "line-width": 5, "line-dasharray": [0.4, 2] },
      });
      map.addLayer({
        id: "segments",
        type: "line",
        source: "segments",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": MAP_COLORS.route, "line-width": 6 },
      });
      map.addLayer({
        id: "events",
        type: "circle",
        source: "points",
        filter: ["==", ["get", "source"], "EVENT"],
        paint: {
          "circle-radius": 9,
          "circle-color": ["match", ["get", "event"], "workday_end", MAP_COLORS.end, MAP_COLORS.start],
          "circle-stroke-color": ["match", ["get", "event"], "workday_end", MAP_COLORS.endStroke, color.mapBg],
          "circle-stroke-width": 4,
        },
      });
      // Con la jornada en curso, la última ubicación conocida.
      const last = track.points.features.at(-1);
      if (live && last) {
        map.addSource("last", { type: "geojson", data: { type: "FeatureCollection", features: [last] } });
        map.addLayer({
          id: "last",
          type: "circle",
          source: "last",
          paint: { "circle-radius": 9, "circle-color": MAP_COLORS.end, "circle-stroke-color": MAP_COLORS.endStroke, "circle-stroke-width": 5 },
        });
      }
    },
    () => {
      const bounds = trackBounds(track);
      return bounds ? { bounds, fitBoundsOptions: { padding: 48, maxZoom: 17 } } : { center: [-58.38, -34.6], zoom: 11 };
    },
    [track, live],
  );

  return (
    <div className="rc-map-frame">
      {failed ? <MapFailed onRetry={retry} /> : null}
      <div
        ref={container}
        className="rc-map"
        style={{ height }}
        role="img"
        aria-label="Mapa del recorrido: los tramos registrados en violeta y los huecos sin datos en naranja punteado"
        hidden={failed}
      />
      {failed ? null : (
        <ul className="rc-legend" aria-label="Referencias del mapa">
          <li>
            <span className="rc-legend__line" style={{ background: MAP_COLORS.route }} />
            Recorrido
          </li>
          <li>
            <span className="rc-legend__line rc-legend__line--dotted" style={{ borderColor: MAP_COLORS.gap }} />
            Sin datos
          </li>
          <li>
            <span className="rc-legend__dot" style={{ background: MAP_COLORS.start }} />
            Inicio
          </li>
          <li>
            <span className="rc-legend__dot" style={{ background: MAP_COLORS.end, boxShadow: `0 0 0 2px ${MAP_COLORS.endStroke}` }} />
            {live ? "Ahora" : "Fin"}
          </li>
        </ul>
      )}
    </div>
  );
}

export interface MapPosition {
  id: string;
  label: string;
  lng: number;
  lat: number;
  /** Sin señal reciente: se marca en amarillo. */
  stale: boolean;
}

/** Última ubicación conocida de cada repartidor en jornada (panel). */
export function PositionsMap({ positions, styleUrl, height = 340 }: { positions: MapPosition[]; styleUrl: string; height?: number }) {
  const { container, failed, retry } = useMap(
    styleUrl,
    (_maplibre, map) => {
      map.addSource("positions", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: positions.map((p) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
            properties: { id: p.id, label: p.label, stale: p.stale },
          })),
        },
      });
      const fill = ["case", ["get", "stale"], MAP_COLORS.stale, MAP_COLORS.live] as unknown as string;
      map.addLayer({ id: "halo", type: "circle", source: "positions", paint: { "circle-radius": 22, "circle-color": fill, "circle-opacity": 0.25 } });
      map.addLayer({
        id: "dot",
        type: "circle",
        source: "positions",
        paint: { "circle-radius": 11, "circle-color": fill, "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 3 },
      });
    },
    (maplibre) => {
      if (positions.length === 0) return { center: [-58.38, -34.6], zoom: 11 };
      const bounds = new maplibre.LngLatBounds();
      for (const p of positions) bounds.extend([p.lng, p.lat]);
      return { bounds, fitBoundsOptions: { padding: 60, maxZoom: 15 } };
    },
    [JSON.stringify(positions)],
  );

  return (
    <div className="rc-map-frame rc-map-frame--flat">
      {failed ? <MapFailed onRetry={retry} /> : null}
      <div
        ref={container}
        className="rc-map"
        style={{ height }}
        role="img"
        aria-label={`Mapa con la última ubicación de ${positions.length} ${positions.length === 1 ? "repartidor" : "repartidores"} en jornada`}
        hidden={failed}
      />
    </div>
  );
}
