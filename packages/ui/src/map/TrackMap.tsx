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
import { gapLines, type LngLat, type MapStop, type RouteLeg, trackBounds, type WorkdayTrack } from "@routcontrol/domain";
// El worker de MapLibre v6 es un archivo aparte: se publica con las apps (mismo origen) y se le
// dice a MapLibre dónde está. Sin esto lo busca junto al código empaquetado y no lo encuentra.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";

import { type ResolvedTheme, useTheme } from "../theme";
import { color, lightColor } from "../tokens";
import { classifyFailure, describeResource, errorDetails, type MapFailureKind, recordMapError } from "./diagnostics";
import { offlineFirst, type TileHandler } from "./offline";
import { spreadOffsets, stopElement, updateStopElement } from "./stopMarker";
import { absolute, buildStyle, DEFAULT_MAP_SOURCE, type MapSource } from "./style";

export { DEFAULT_MAP_SOURCE, type MapSource } from "./style";
export { downloadTiles, type DownloadProgress, type OfflineTileJson, type OfflineTileStore, setOfflineTiles } from "./offline";

export function mapColors(theme: ResolvedTheme) {
  const c = theme === "light" ? lightColor : color;
  return {
    route: c.route,
    gap: c.gap,
    point: c.violet300,
    start: theme === "light" ? "#059669" : color.success,
    end: color.white,
    endStroke: c.primary,
    live: c.primary,
    stale: theme === "light" ? "#D97706" : color.warning,
    bg: c.mapBg,
  } as const;
}

/** Colores del tema oscuro (por defecto). */
export const MAP_COLORS = mapColors("dark");

type MapLibre = typeof import("maplibre-gl");
type MapInstance = import("maplibre-gl").Map;

let ready: Promise<MapLibre> | null = null;

/** Carga MapLibre una sola vez: worker propio y protocolo pmtiles://. */
function loadMapLibre(): Promise<MapLibre> {
  ready ??= (async () => {
    const [maplibre, { Protocol }] = await Promise.all([import("maplibre-gl"), import("pmtiles")]);
    await import("maplibre-gl/dist/maplibre-gl.css");
    maplibre.setWorkerUrl(absolute(workerUrl));
    // Primero lo guardado en el teléfono (mapa sin conexión, ADR-018), después la red.
    maplibre.addProtocol("pmtiles", offlineFirst(new Protocol().tilev4 as unknown as TileHandler) as never);
    return maplibre;
  })().catch((error: unknown) => {
    ready = null; // que "Reintentar" vuelva a intentarlo
    throw error;
  });
  return ready;
}

/**
 * Deja en el caché del Service Worker el código del mapa (MapLibre, su worker y sus estilos), para
 * que el mapa abra sin conexión. Lo llama la descarga del mapa sin conexión (ADR-018).
 */
export async function preloadMapCode(): Promise<void> {
  await loadMapLibre();
  await fetch(absolute(workerUrl));
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
  setup: (maplibre: MapLibre, map: MapInstance, colors: ReturnType<typeof mapColors>) => void,
  options: (maplibre: MapLibre) => Partial<import("maplibre-gl").MapOptions>,
  deps: unknown[],
  extra: { controls?: boolean } = {},
) {
  const container = useRef<HTMLDivElement>(null);
  // El mapa ya cargado (para los mapas que se actualizan sin recrearse, como el de entregas).
  const mapRef = useRef<{ maplibre: MapLibre; map: MapInstance } | null>(null);
  const [ready, setReady] = useState(0);
  const [failure, setFailure] = useState<MapFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { resolved: theme } = useTheme();

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
          style: buildStyle(source, theme),
          attributionControl: false,
          ...options(maplibre),
        });
      } catch (error) {
        // Sin WebGL (o deshabilitado) el mapa no se puede crear.
        return fail(error, undefined, /webgl/i.test(String(error)) ? "WebGL del navegador" : "mapa");
      }
      if (extra.controls !== false) map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
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
        if (!map) return;
        setup(maplibre, map, mapColors(theme));
        mapRef.current = { maplibre, map };
        setReady((n) => n + 1);
      });
    })();

    return () => {
      disposed = true;
      mapRef.current = null;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.pmtiles, source.assets, attempt, theme, ...deps]);

  return { container, failure, retry: () => setAttempt((n) => n + 1), colors: mapColors(theme), mapRef, ready };
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
  const { container, failure, retry, colors: MAP_COLORS } = useMap(
    source,
    (_maplibre, map, MAP_COLORS) => {
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
          "circle-stroke-color": ["match", ["get", "event"], "workday_end", MAP_COLORS.endStroke, MAP_COLORS.bg],
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

// --- Mapa de entregas del día (ADR-019) ---------------------------------------------------------

export interface StopsMapHandle {
  /** Centra en un punto (mi ubicación). */
  centerOn(lat: number, lng: number): void;
  /** Encuadra todas las paradas (y mi ubicación, si hay). */
  fitAll(): void;
}

export interface MyLocation {
  lat: number;
  lng: number;
  accuracy: number;
}

/**
 * Las paradas del día como círculos numerados (color por estado, estilo de Ruta.dc.html), la línea de la ruta y mi
 * ubicación como un punto azul. A diferencia de los otros mapas, se crea una sola vez y se
 * actualiza en el lugar: la ubicación cambia seguido y recrear el mapa haría parpadear todo.
 * `interactive: false` es el mapa chico de la ficha (sin controles ni arrastre).
 */
export function StopsMap({
  stops,
  legs = [],
  me = null,
  selectedId = null,
  nextId = null,
  onSelect,
  source = DEFAULT_MAP_SOURCE,
  height,
  interactive = true,
  bottomPadding = 0,
  controlRef,
  label,
}: {
  stops: MapStop[];
  legs?: RouteLeg[];
  me?: MyLocation | null;
  selectedId?: string | null;
  /** La próxima parada: más grande, con anillos que laten y la etiqueta "Próxima". */
  nextId?: string | null;
  onSelect?: (id: string | null) => void;
  source?: MapSource;
  /** Alto fijo; sin alto, ocupa el contenedor (pantalla Mapa). */
  height?: number;
  interactive?: boolean;
  /** Espacio que tapa la tarjeta de abajo (para encuadrar). */
  bottomPadding?: number;
  controlRef?: Ref<StopsMapHandle>;
  label: string;
}) {
  const latest = useRef({ stops, me, onSelect, bottomPadding });
  latest.current = { stops, me, onSelect, bottomPadding };
  const markers = useRef(new Map<string, { marker: import("maplibre-gl").Marker; el: HTMLElement }>());
  const meMarker = useRef<import("maplibre-gl").Marker | null>(null);

  // Arriba los chips (y la etiqueta "Próxima"), a la derecha los botones flotantes, abajo lo que
  // tape la pantalla (barra, leyenda o tarjeta): las paradas encuadradas quedan siempre a la vista.
  const fitPadding = () =>
    interactive ? { top: 120, left: 60, right: 90, bottom: 40 + latest.current.bottomPadding } : { top: 30, left: 30, right: 30, bottom: 30 };

  const { container, failure, retry, mapRef, ready } = useMap(
    source,
    (_maplibre, map, c) => {
      markers.current.clear();
      meMarker.current = null;
      map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "route-streets",
        type: "line",
        source: "route",
        filter: ["==", ["get", "straight"], false],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.route, "line-width": 6 }, // como Ruta.dc.html
      });
      map.addLayer({
        id: "route-straight",
        type: "line",
        source: "route",
        filter: ["==", ["get", "straight"], true],
        layout: { "line-cap": "round" },
        paint: { "line-color": c.route, "line-width": 3, "line-dasharray": [1.5, 2], "line-opacity": 0.8 },
      });
      if (interactive) map.on("click", () => latest.current.onSelect?.(null));
    },
    (maplibre) => {
      const base = interactive ? {} : { interactive: false };
      const pts = latest.current.stops.map((s) => [s.lng, s.lat] as LngLat);
      const here = latest.current.me;
      if (here && interactive) pts.push([here.lng, here.lat]);
      if (pts.length === 0) return { ...base, center: [-58.4, -34.61] as LngLat, zoom: 11 };
      if (pts.length === 1) return { ...base, center: pts[0], zoom: 15 };
      const bounds = new maplibre.LngLatBounds();
      for (const p of pts) bounds.extend(p);
      return { ...base, bounds, fitBoundsOptions: { padding: fitPadding(), maxZoom: 16 } };
    },
    [interactive],
    { controls: interactive },
  );

  // Casitas: se agregan, actualizan y quitan en el lugar.
  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return;
    const seen = new Set<string>();
    for (const stop of stops) {
      seen.add(stop.id);
      const existing = markers.current.get(stop.id);
      if (existing) {
        updateStopElement(existing.el, stop, stop.id === selectedId, stop.id === nextId);
        existing.marker.setLngLat([stop.lng, stop.lat]);
      } else {
        const el = stopElement(stop, stop.id === selectedId, (id) => latest.current.onSelect?.(id), stop.id === nextId);
        if (!interactive) el.tabIndex = -1;
        const marker = new ctx.maplibre.Marker({ element: el, anchor: "center" }).setLngLat([stop.lng, stop.lat]).addTo(ctx.map);
        markers.current.set(stop.id, { marker, el });
      }
    }
    for (const [id, m] of markers.current) {
      if (!seen.has(id)) {
        m.marker.remove();
        markers.current.delete(id);
      }
    }
    spread();
  }, [ready, stops, selectedId, nextId, interactive, mapRef]);

  // Las que se superponen en pantalla se abren en círculo (se recalcula con cada zoom).
  function spread() {
    const ctx = mapRef.current;
    if (!ctx) return;
    const points = [...markers.current].map(([id, m]) => {
      const p = ctx.map.project(m.marker.getLngLat());
      return { id, x: p.x, y: p.y };
    });
    const offsets = spreadOffsets(points);
    for (const [id, m] of markers.current) m.marker.setOffset(offsets.get(id) ?? [0, 0]);
  }

  useEffect(() => {
    const map = mapRef.current?.map;
    if (!map) return;
    map.on("zoomend", spread);
    return () => {
      map.off("zoomend", spread);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mapRef]);

  // Línea de la ruta.
  useEffect(() => {
    const src = mapRef.current?.map.getSource("route") as import("maplibre-gl").GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: legs.map((leg) => ({ type: "Feature", properties: { straight: leg.straight }, geometry: { type: "LineString", coordinates: leg.coords } })),
    });
  }, [ready, legs, mapRef]);

  // Mi ubicación (punto azul).
  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return;
    if (!me) {
      meMarker.current?.remove();
      meMarker.current = null;
      return;
    }
    if (!meMarker.current) {
      const el = document.createElement("div");
      el.className = "rc-me";
      el.setAttribute("aria-hidden", "true");
      el.innerHTML = '<span class="rc-me__halo"></span><span class="rc-me__dot"></span>';
      meMarker.current = new ctx.maplibre.Marker({ element: el, anchor: "center" }).setLngLat([me.lng, me.lat]).addTo(ctx.map);
    } else {
      meMarker.current.setLngLat([me.lng, me.lat]);
    }
  }, [ready, me, mapRef]);

  // La parada elegida queda a la vista, arriba de la tarjeta.
  useEffect(() => {
    const ctx = mapRef.current;
    const stop = selectedId ? latest.current.stops.find((s) => s.id === selectedId) : null;
    if (!ctx || !stop || !interactive) return;
    ctx.map.easeTo({ center: [stop.lng, stop.lat], padding: { top: 0, left: 0, right: 0, bottom: latest.current.bottomPadding }, duration: 400 });
  }, [ready, selectedId, interactive, mapRef]);

  useImperativeHandle(
    controlRef,
    () => ({
      centerOn(lat, lng) {
        const ctx = mapRef.current;
        ctx?.map.easeTo({ center: [lng, lat], zoom: Math.max(ctx.map.getZoom(), 15), duration: 500 });
      },
      fitAll() {
        const ctx = mapRef.current;
        if (!ctx) return;
        const pts = latest.current.stops.map((s) => [s.lng, s.lat] as LngLat);
        const here = latest.current.me;
        if (here) pts.push([here.lng, here.lat]);
        if (pts.length === 0) return;
        if (pts.length === 1) {
          ctx.map.easeTo({ center: pts[0], zoom: 15, duration: 500 });
          return;
        }
        const bounds = new ctx.maplibre.LngLatBounds();
        for (const p of pts) bounds.extend(p);
        ctx.map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 16, duration: 500 });
      },
    }),
    [mapRef],
  );

  return (
    <div className={`rc-map-frame rc-map-frame--flat rc-stops-map${height ? "" : " rc-stops-map--fill"}`}>
      {failure ? <MapFailed failure={failure} onRetry={retry} /> : null}
      <div ref={container} className="rc-map" style={height ? { height } : undefined} role="region" aria-label={label} hidden={failure !== null} />
    </div>
  );
}
