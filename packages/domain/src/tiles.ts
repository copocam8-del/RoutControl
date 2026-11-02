/**
 * Mapa sin conexión (ADR-018): qué teselas guardar para la zona de los paquetes del día.
 * Teselas XYZ (Web Mercator), como las del archivo PMTiles.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface TileXYZ {
  z: number;
  x: number;
  y: number;
}

export const tileKey = (t: TileXYZ) => `${t.z}/${t.x}/${t.y}`;

const MAX_LAT = 85.05112878;

export function lngToTileX(lng: number, z: number): number {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)));
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const rad = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)));
}

/** Rectángulo que contiene los puntos, agrandado `marginM` metros para cada lado. null sin puntos. */
export function boundsAround(points: readonly LatLng[], marginM: number): Bounds | null {
  if (points.length === 0) return null;
  let b: Bounds = { minLat: Infinity, minLng: Infinity, maxLat: -Infinity, maxLng: -Infinity };
  for (const p of points) {
    b = { minLat: Math.min(b.minLat, p.lat), minLng: Math.min(b.minLng, p.lng), maxLat: Math.max(b.maxLat, p.lat), maxLng: Math.max(b.maxLng, p.lng) };
  }
  const dLat = marginM / 111_320;
  const midLat = ((b.minLat + b.maxLat) / 2) * (Math.PI / 180);
  const dLng = marginM / (111_320 * Math.max(0.01, Math.cos(midLat)));
  return { minLat: b.minLat - dLat, minLng: b.minLng - dLng, maxLat: b.maxLat + dLat, maxLng: b.maxLng + dLng };
}

/** Intersección con los límites del mapa (el archivo solo tiene AMBA). null si no se tocan. */
export function clipBounds(a: Bounds, b: Bounds): Bounds | null {
  const r = { minLat: Math.max(a.minLat, b.minLat), minLng: Math.max(a.minLng, b.minLng), maxLat: Math.min(a.maxLat, b.maxLat), maxLng: Math.min(a.maxLng, b.maxLng) };
  return r.minLat <= r.maxLat && r.minLng <= r.maxLng ? r : null;
}

function rangeAt(b: Bounds, z: number) {
  return { x0: lngToTileX(b.minLng, z), x1: lngToTileX(b.maxLng, z), y0: latToTileY(b.maxLat, z), y1: latToTileY(b.minLat, z) };
}

export function countTiles(b: Bounds, minZoom: number, maxZoom: number): number {
  let n = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const r = rangeAt(b, z);
    n += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  }
  return n;
}

export function tilesIn(b: Bounds, minZoom: number, maxZoom: number): TileXYZ[] {
  const out: TileXYZ[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const r = rangeAt(b, z);
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) out.push({ z, x, y });
  }
  return out;
}

export interface AreaPlan {
  bounds: Bounds;
  minZoom: number;
  /** El zoom más cercano que entra en el límite (las calles con nombre se ven desde 14–15). */
  maxZoom: number;
  tiles: TileXYZ[];
}

/**
 * Plan de descarga: la zona de los puntos con su margen, recortada al mapa, desde `minZoom` hasta
 * el zoom más alto (≤ `maxZoom`) cuyo total no pase de `maxTiles`. null si no hay nada que bajar.
 */
export function planArea(
  points: readonly LatLng[],
  opts: { marginM: number; minZoom: number; maxZoom: number; maxTiles: number; limit?: Bounds },
): AreaPlan | null {
  let bounds = boundsAround(points, opts.marginM);
  if (bounds && opts.limit) bounds = clipBounds(bounds, opts.limit);
  if (!bounds) return null;
  for (let z = opts.maxZoom; z >= opts.minZoom; z--) {
    if (countTiles(bounds, opts.minZoom, z) <= opts.maxTiles) return { bounds, minZoom: opts.minZoom, maxZoom: z, tiles: tilesIn(bounds, opts.minZoom, z) };
  }
  return null;
}
