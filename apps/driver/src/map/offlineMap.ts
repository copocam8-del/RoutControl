/**
 * Mapa sin conexión (ADR-018): guarda en el teléfono las calles de la zona de los paquetes del día.
 *
 * - **Qué zona:** el rectángulo que contiene las direcciones con ubicación, con 1 km de margen,
 *   recortado al mapa (AMBA). De zoom 0 hasta 15 (el máximo del archivo); si la zona es muy grande,
 *   se baja el zoom máximo hasta entrar en el límite de teselas.
 * - **Dónde:** IndexedDB (`mapTiles`). El protocolo del mapa mira ahí antes que en la red, así que
 *   además ahorra datos móviles.
 * - **Qué más:** el código del mapa (MapLibre), las fuentes y los íconos quedan en el caché del
 *   Service Worker, para que el mapa abra sin conexión.
 * - **Reemplazo:** se guarda una sola zona. Al guardar otra, se borran las teselas que ya no entran.
 * - **Cuándo:** lo pide el repartidor (botón), no solo: puede estar con datos móviles.
 */
import { type Bounds, planArea, tileKey } from "@routcontrol/domain";
import type { DownloadProgress, OfflineTileJson, OfflineTileStore } from "@routcontrol/ui/map";

import type { AppConfig } from "../config";
import { type DriverDB, getMeta, type LocalPackage, setMeta } from "../store/db";

export const MARGIN_M = 1000;
// ~53 KB por tesela (medido con amba.pmtiles): 1000 teselas son ~50 MB como máximo.
export const MAX_TILES = 1000;
const MIN_ZOOM = 0;
const MAX_ZOOM = 15;
/** Límites del mapa autoalojado (cabecera de amba.pmtiles, ADR-008). */
export const MAP_LIMIT: Bounds = { minLat: -34.9, minLng: -58.75, maxLat: -34.45, maxLng: -58.2 };
/** Fuentes del estilo del mapa y rangos de caracteres para nombres de calles en español. */
const FONTSTACKS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
const GLYPH_RANGES = ["0-255", "256-511", "8192-8447"];
const SPRITES = ["dark", "light"].flatMap((t) => [`${t}.json`, `${t}.png`, `${t}@2x.json`, `${t}@2x.png`]);

const META_KEY = "offline_map";

export interface OfflineMapInfo {
  saved_at: string;
  /** Paquetes con ubicación que entraron en la zona. */
  packages: number;
  tiles: number;
  bytes: number;
  max_zoom: number;
  bounds: Bounds;
  pmtiles: string;
  tile_json: OfflineTileJson;
}

export type OfflineMapState =
  | { status: "idle"; info: OfflineMapInfo | null }
  | { status: "saving"; info: OfflineMapInfo | null; progress: DownloadProgress }
  | { status: "error"; info: OfflineMapInfo | null; error: string };

type MapModule = Pick<typeof import("@routcontrol/ui/map"), "downloadTiles" | "preloadMapCode" | "setOfflineTiles">;

export interface OfflineMapDeps {
  db: DriverDB;
  config: Pick<AppConfig, "map">;
  /** El módulo del mapa se carga recién cuando hace falta (MapLibre pesa ~1 MB). */
  loadMap?: () => Promise<MapModule>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export function located(packages: readonly LocalPackage[]) {
  return packages.flatMap((p) => (p.address.location ? [p.address.location] : []));
}

const inside = (b: Bounds, p: { lat: number; lng: number }) => p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;

export class OfflineMap {
  private state: OfflineMapState = { status: "idle", info: null };
  private listeners = new Set<(s: OfflineMapState) => void>();
  private abort: AbortController | null = null;
  private readonly loadMap: () => Promise<MapModule>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly deps: OfflineMapDeps) {
    this.loadMap = deps.loadMap ?? (() => import("@routcontrol/ui/map"));
    this.fetchImpl = deps.fetchImpl ?? ((...a) => globalThis.fetch(...a));
    this.now = deps.now ?? (() => new Date());
  }

  getState(): OfflineMapState {
    return this.state;
  }

  subscribe(listener: (s: OfflineMapState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: OfflineMapState) {
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  /** Lee lo guardado (al abrir la app). */
  async init(): Promise<void> {
    const info = (await getMeta<OfflineMapInfo>(this.deps.db, META_KEY)) ?? null;
    if (this.state.status === "idle") this.set({ status: "idle", info });
  }

  /** Lo que lee el protocolo del mapa: las teselas y el TileJSON guardados. */
  store(): OfflineTileStore {
    const db = this.deps.db;
    return {
      getTile: async (key) => (await db.mapTiles.get(key))?.data,
      getTileJson: async () => (await getMeta<OfflineMapInfo>(db, META_KEY))?.tile_json,
    };
  }

  /** Cuántos paquetes con ubicación quedan fuera de la zona guardada (0 si todos entran). */
  outside(packages: readonly LocalPackage[]): number {
    const info = this.state.info;
    const points = located(packages).filter((p) => inside(MAP_LIMIT, p));
    if (!info) return points.length;
    return points.filter((p) => !inside(info.bounds, p)).length;
  }

  /** Estimación antes de bajar: teselas y zoom máximo (null si no hay direcciones con ubicación en el mapa). */
  plan(packages: readonly LocalPackage[]) {
    return planArea(located(packages), { marginM: MARGIN_M, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, maxTiles: MAX_TILES, limit: MAP_LIMIT });
  }

  async save(packages: readonly LocalPackage[]): Promise<void> {
    if (this.state.status === "saving") return;
    const info = this.state.info;
    const plan = this.plan(packages);
    if (!plan) {
      this.set({ status: "error", info, error: "Ningún paquete tiene una dirección ubicada en el mapa." });
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    this.set({ status: "saving", info, progress: { done: 0, total: plan.tiles.length, bytes: 0 } });
    const db = this.deps.db;
    try {
      const map = await this.loadMap();
      const pmtiles = new URL(this.deps.config.map.pmtiles, globalThis.location?.href ?? "http://localhost/").href;
      const result = await map.downloadTiles(pmtiles, plan.tiles, (key, data) => db.mapTiles.put({ key, data }).then(() => undefined), {
        signal: abort.signal,
        onProgress: (progress) => this.set({ status: "saving", info, progress }),
      });
      // Lo que ya no entra en la zona nueva se borra (una sola zona guardada).
      const keep = new Set(plan.tiles.map(tileKey));
      const stale = (await db.mapTiles.toCollection().primaryKeys()).filter((k) => !keep.has(k));
      await db.mapTiles.bulkDelete(stale);
      await this.cacheAssets(map);
      const saved: OfflineMapInfo = {
        saved_at: this.now().toISOString(),
        packages: located(packages).filter((p) => inside(plan.bounds, p)).length,
        tiles: result.saved,
        bytes: result.bytes,
        max_zoom: plan.maxZoom,
        bounds: plan.bounds,
        pmtiles,
        tile_json: result.tileJson,
      };
      await setMeta(db, META_KEY, saved);
      map.setOfflineTiles(this.store());
      this.set({ status: "idle", info: saved });
    } catch (e) {
      const cancelled = abort.signal.aborted;
      this.set(
        cancelled
          ? { status: "idle", info }
          : { status: "error", info, error: e instanceof TypeError ? "Sin conexión: probá de nuevo con señal." : "No se pudo guardar el mapa." },
      );
    } finally {
      this.abort = null;
    }
  }

  cancel(): void {
    this.abort?.abort();
  }

  /** Borra el mapa guardado (Perfil o al cerrar sesión). */
  async clear(): Promise<void> {
    this.cancel();
    await this.deps.db.mapTiles.clear();
    await this.deps.db.meta.delete(META_KEY);
    this.set({ status: "idle", info: null });
  }

  /** Fuentes, íconos y código del mapa al caché del Service Worker (CacheFirst). */
  private async cacheAssets(map: MapModule): Promise<void> {
    const assets = this.deps.config.map.assets.replace(/\/$/, "");
    const urls = [
      ...FONTSTACKS.flatMap((f) => GLYPH_RANGES.map((r) => `${assets}/fonts/${encodeURIComponent(f)}/${r}.pbf`)),
      ...SPRITES.map((s) => `${assets}/sprites/${s}`),
    ];
    await Promise.all(urls.map((u) => this.fetchImpl(u).catch(() => undefined)));
    await map.preloadMapCode().catch(() => undefined);
  }
}

/** Para mostrar el tamaño ("3,4 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

let registered: OfflineTileStore | null = null;

/**
 * Carga el módulo del mapa con el almacén ya registrado: así hasta la primera tesela sale de lo
 * guardado. Las pantallas con mapa lo usan en su `lazy()`.
 */
export async function loadMapModule(): Promise<typeof import("@routcontrol/ui/map")> {
  const m = await import("@routcontrol/ui/map");
  m.setOfflineTiles(registered);
  return m;
}

/** createApp registra el almacén de la app (una por pestaña). */
export function registerOfflineStore(store: OfflineTileStore | null): void {
  registered = store;
}
