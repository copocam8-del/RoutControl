/**
 * Mapas (MapLibre), en el tema oscuro de las maquetas. Los usan la PWA ("Mi recorrido") y el panel.
 *
 * Todo sale de nuestro origen (ADR-008): teselas de OpenStreetMap en PMTiles, fuentes, íconos y el
 * worker de MapLibre. Nada depende de otros dominios, así que no lo frenan los bloqueadores (Brave)
 * y queda listo para funcionar sin conexión.
 *
 * Se importa aparte (`@routcontrol/ui/map`) y conviene cargarlo con `lazy()`: MapLibre pesa ~1 MB
 * y no tiene que ir en la carga inicial.
 *
 * - `TrackMap`: recorrido de una jornada. Tramos registrados en violeta continuo, huecos en naranja
 *   punteado (ahí NO hay datos), inicio en verde y fin (o última ubicación) en blanco con borde violeta.
 * - `PositionsMap`: última ubicación de cada repartidor (panel). Violeta = con señal; amarillo = sin
 *   señal reciente.
 *
 * Si algo falla, el error exacto (mensaje, recurso y URL) queda en `getMapErrors()` para la
 * pantalla de Diagnóstico, y el mensaje distingue "sin conexión" de "no se pudo cargar el mapa".
 */
import { gapLines, trackBounds, type WorkdayTrack } from "@routcontrol/domain";
// El worker de MapLibre v6 es un archivo aparte: se publica con las apps (mismo origen) y se le
// dice a MapLibre dónde está. Sin esto lo busca junto al código empaquetado y no lo encuentra.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef, useState } from "react";

import { color } from "../tokens";
import { classifyFailure, describeResource, errorDetails, type MapFailureKind, recordMapError } from "./diagnostics";
import { absolute, buildStyle, DEFAULT_MAP_SOURCE, type MapSource } from "./style";

export { DEFAULT_MAP_SOURCE, type MapSource } from "./style";

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

let ready: Promise<MapLibre> | null = null;

/** Carga MapLibre una sola vez: worker propio y protocolo pmtiles://. */
function loadMapLibre(): Promise<MapLibre> {
  ready ??= (async () => {
    const [maplibre, { Protocol }] = await Promise.all([import("maplibre-gl"), import("pmtiles")]);
    await import("maplibre-gl/dist/maplibre-gl.css");
    maplibre.setWorkerUrl(absolute(workerUrl));
    maplibre.addProtocol("pmtiles", new Protocol().tile);
    return maplibre;
  })().catch((error: unknown) => {
    ready = null; // que "Reintentar" vuelva a intentarlo
    throw error;
  });
  return ready;
}

export interface MapFailure {
  kind: MapFailureKind;
  resource: string;
  message: string;
  url: string | null;
}

/** Crea el mapa y maneja la carga diferida, los errores y "Reintentar". */
function useMap(
  source: MapSource,
  setup: (maplibre: MapLibre, map: MapInstance) => void,
  options: (maplibre: MapLibre) => Partial<import("maplibre-gl").MapOptions>,
  deps: unknown[],
) {
  const container = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<MapFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let map: MapInstance | null = null;
    let reported = false;
    setFailure(null);

    const fail = async (error: unknown, fallbackUrl?: string, fallbackResource?: string) => {
      const details = errorDetails(error);
      const url = details.url ?? fallbackUrl ?? null;
      const kind = await classifyFailure(error, details.status, absolute(source.pmtiles));
      const resource = fallbackResource ?? describeResource(url);
      const record = { at: Date.now(), kind, resource, message: details.message, url, status: details.status };
      recordMapError(record);
      console.warn("Mapa:", record);
      if (!disposed && !reported) {
        reported = true;
        setFailure({ kind, resource, message: details.message, url });
      }
    };

    void (async () => {
      let maplibre: MapLibre;
      try {
        maplibre = await loadMapLibre();
      } catch (error) {
        return fail(error, undefined, "código de MapLibre");
      }
      if (disposed || !container.current) return;
      try {
        map = new maplibre.Map({
          container: container.current,
          style: buildStyle(source),
          attributionControl: false,
          ...options(maplibre),
        });
      } catch (error) {
        // Sin WebGL (o deshabilitado) el mapa no se puede crear.
        return fail(error, undefined, /webgl/i.test(String(error)) ? "WebGL del navegador" : "mapa");
      }
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      // Crédito de OpenStreetMap arriba: abajo está la leyenda (como la maqueta).
      map.addControl(new maplibre.AttributionControl({ compact: true }), "top-left");
      let tilesOk = false;
      map.on("data", (event) => {
        const e = event as { dataType?: string; tile?: unknown };
        if (e.dataType === "source" && e.tile) tilesOk = true;
      });
      map.on("error", (event) => {
        // El estilo, las teselas, las fuentes o el worker no cargaron. Un error suelto de una
        // tesela con el resto del mapa visible no se muestra en pantalla, pero queda registrado.
        const fatal = !map?.isStyleLoaded() || !tilesOk;
        const url = (event as { sourceId?: string }).sourceId === "protomaps" ? absolute(source.pmtiles) : undefined;
        if (fatal) {
          void fail(event.error, url);
        } else {
          const details = errorDetails(event.error);
          recordMapError({ at: Date.now(), kind: "failed", resource: describeResource(details.url ?? url), ...details, url: details.url ?? url ?? null });
        }
      });
      map.on("load", () => {
        if (map) setup(maplibre, map);
      });
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.pmtiles, source.assets, attempt, ...deps]);

  return { container, failure, retry: () => setAttempt((n) => n + 1) };
}

export function MapFailed({ failure, onRetry }: { failure: MapFailure; onRetry: () => void }) {
  const offline = failure.kind === "offline";
  return (
    <div className="rc-state rc-map-failed">
      <div className="rc-alert rc-alert--error" role="alert">
        <div className="rc-alert__body">
          <div className="rc-alert__title">{offline ? "Sin conexión" : "No se pudo cargar el mapa"}</div>
          {offline
            ? "El mapa se va a ver cuando vuelva la señal. Los datos del recorrido siguen abajo."
            : "Los datos del recorrido siguen abajo. El detalle del error quedó en Diagnóstico."}
          <details className="rc-map-failed__details">
            <summary>Detalle técnico</summary>
            <div>Recurso: {failure.resource}</div>
            <div className="rc-mono">{failure.message}</div>
            {failure.url ? <div className="rc-mono">{failure.url}</div> : null}
          </details>
        </div>
      </div>
      <button type="button" className="rc-btn rc-btn--secondary" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}

export function TrackMap({
  track,
  source = DEFAULT_MAP_SOURCE,
  height = 360,
  /** Jornada en curso: el último punto es "Ahora", no "Fin". */
  live = false,
}: {
  track: WorkdayTrack;
  source?: MapSource;
  height?: number;
  live?: boolean;
}) {
  const { container, failure, retry } = useMap(
    source,
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
      {failure ? <MapFailed failure={failure} onRetry={retry} /> : null}
      <div
        ref={container}
        className="rc-map"
        style={{ height }}
        role="img"
        aria-label="Mapa del recorrido: los tramos registrados en violeta y los huecos sin datos en naranja punteado"
        hidden={failure !== null}
      />
      {failure ? null : (
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
  /** Etiqueta corta junto al punto (iniciales). */
  short?: string;
}

/** Última ubicación conocida de cada repartidor en jornada (panel). */
export function PositionsMap({
  positions,
  source = DEFAULT_MAP_SOURCE,
  height = 340,
}: {
  positions: MapPosition[];
  source?: MapSource;
  height?: number;
}) {
  const { container, failure, retry } = useMap(
    source,
    (maplibre, map) => {
      // Marcadores HTML (como la maqueta): punto violeta que "late" con señal, amarillo sin señal
      // reciente, y las iniciales del repartidor al lado.
      for (const p of positions) {
        const el = document.createElement("div");
        el.className = `rc-pin${p.stale ? " rc-pin--stale" : ""}`;
        el.setAttribute("aria-hidden", "true");
        el.innerHTML = `${p.stale ? "" : '<span class="rc-pin__ping"></span>'}<span class="rc-pin__dot"></span><span class="rc-pin__label"></span>`;
        el.querySelector(".rc-pin__label")!.textContent = p.short ?? p.label;
        el.title = p.label;
        new maplibre.Marker({ element: el, anchor: "center" }).setLngLat([p.lng, p.lat]).addTo(map);
      }
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
      {failure ? <MapFailed failure={failure} onRetry={retry} /> : null}
      <div
        ref={container}
        className="rc-map"
        style={{ height }}
        role="img"
        aria-label={`Mapa con la última ubicación de ${positions.length} ${positions.length === 1 ? "repartidor" : "repartidores"} en jornada`}
        hidden={failure !== null}
      />
    </div>
  );
}
