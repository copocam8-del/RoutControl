/**
 * Mapa sin conexión (ADR-018). MapLibre pide las teselas por el protocolo `pmtiles://`; acá se
 * envuelve ese protocolo para que primero busque en lo guardado en el teléfono (`OfflineTileStore`)
 * y solo si no está vaya a la red. Si no hay red, el TileJSON (los límites del mapa) también sale
 * de lo guardado.
 *
 * `downloadTiles` baja del mismo archivo PMTiles las teselas de una zona (sin pasar por el caché
 * del Service Worker: van a IndexedDB, que las puede borrar o reemplazar la app).
 */
import { tileKey, type TileXYZ } from "@routcontrol/domain";

export interface OfflineTileStore {
  getTile(key: string): Promise<Uint8Array | undefined>;
  getTileJson(): Promise<OfflineTileJson | undefined>;
}

export interface OfflineTileJson {
  minzoom: number;
  maxzoom: number;
  bounds: [number, number, number, number];
}

type TileParams = { url: string; type?: string };
type TileResult = { data: unknown; cacheControl?: string; expires?: string };
export type TileHandler = (params: TileParams, abort: AbortController) => Promise<TileResult>;

let store: OfflineTileStore | null = null;

/** La app que guarda teselas registra acá su almacén (o null para dejar de usarlo). */
export function setOfflineTiles(s: OfflineTileStore | null): void {
  store = s;
}

const TILE_RE = /\/(\d+)\/(\d+)\/(\d+)$/;

/** Protocolo pmtiles:// que mira primero lo guardado en el teléfono. */
export function offlineFirst(online: TileHandler, getStore: () => OfflineTileStore | null = () => store): TileHandler {
  return async (params, abort) => {
    const s = getStore();
    if (params.type === "json") {
      try {
        return await online(params, abort);
      } catch (error) {
        const saved = s ? await s.getTileJson() : undefined;
        if (!saved) throw error;
        return { data: { ...saved, tiles: [`${params.url}/{z}/{x}/{y}`] } };
      }
    }
    const m = TILE_RE.exec(params.url);
    if (s && m) {
      const saved = await s.getTile(`${m[1]}/${m[2]}/${m[3]}`);
      if (saved) return { data: saved };
    }
    return online(params, abort);
  };
}

export interface DownloadProgress {
  done: number;
  total: number;
  bytes: number;
}

/**
 * Baja las teselas de la lista desde el PMTiles y las entrega a `put`. Las que no existen en el
 * archivo (mar, fuera del mapa) se saltean. Devuelve los límites del archivo para el TileJSON.
 */
export async function downloadTiles(
  pmtilesUrl: string,
  tiles: readonly TileXYZ[],
  put: (key: string, data: Uint8Array) => Promise<void>,
  opts: { onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal; concurrency?: number; pmtiles?: PMTilesLike } = {},
): Promise<{ tileJson: OfflineTileJson; saved: number; bytes: number }> {
  const archive = opts.pmtiles ?? new (await import("pmtiles")).PMTiles(pmtilesUrl);
  const header = await archive.getHeader();
  const tileJson: OfflineTileJson = { minzoom: header.minZoom, maxzoom: header.maxZoom, bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat] };
  let next = 0;
  let done = 0;
  let saved = 0;
  let bytes = 0;
  const worker = async () => {
    while (next < tiles.length) {
      opts.signal?.throwIfAborted();
      const t = tiles[next++]!;
      const res = await archive.getZxy(t.z, t.x, t.y, opts.signal);
      if (res?.data) {
        const data = new Uint8Array(res.data);
        await put(tileKey(t), data);
        saved += 1;
        bytes += data.byteLength;
      }
      done += 1;
      opts.onProgress?.({ done, total: tiles.length, bytes });
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, tiles.length) }, worker));
  return { tileJson, saved, bytes };
}

/** Lo que se usa de `PMTiles` (para probar sin red). */
export interface PMTilesLike {
  getHeader(): Promise<{ minZoom: number; maxZoom: number; minLon: number; minLat: number; maxLon: number; maxLat: number }>;
  getZxy(z: number, x: number, y: number, signal?: AbortSignal): Promise<{ data: ArrayBuffer } | undefined>;
}
