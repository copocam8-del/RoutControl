/**
 * Errores del mapa, para la pantalla de Diagnóstico (ADR-008). No importa MapLibre: se puede
 * leer desde cualquier pantalla sin cargar el mapa.
 *
 * Se guardan los últimos en localStorage para que sigan ahí después de cambiar de pantalla o de
 * recargar (el repartidor saca la captura desde Perfil › Diagnóstico).
 */

export type MapFailureKind = "offline" | "failed";

export interface MapErrorRecord {
  /** Momento del error (ms). */
  at: number;
  kind: MapFailureKind;
  /** Qué recurso falló, en palabras: "teselas (PMTiles)", "worker de MapLibre", "WebGL"… */
  resource: string;
  message: string;
  url: string | null;
  status: number | null;
}

const KEY = "rc-map-errors";
const MAX = 10;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getMapErrors(): MapErrorRecord[] {
  try {
    return JSON.parse(storage()?.getItem(KEY) ?? "[]") as MapErrorRecord[];
  } catch {
    return [];
  }
}

export function recordMapError(record: MapErrorRecord): void {
  const list = [record, ...getMapErrors()].slice(0, MAX);
  try {
    storage()?.setItem(KEY, JSON.stringify(list));
  } catch {
    // sin almacenamiento (modo privado lleno): igual se avisa a la pantalla
  }
  for (const l of listeners) l();
}

export function clearMapErrors(): void {
  storage()?.removeItem(KEY);
  for (const l of listeners) l();
}

export function subscribeMapErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Qué recurso es, según su URL. */
export function describeResource(url: string | null | undefined): string {
  if (!url) return "mapa";
  if (/\.pmtiles(\?|$)/.test(url) || url.startsWith("pmtiles://")) return "teselas (PMTiles)";
  if (url.includes("/fonts/") || url.endsWith(".pbf")) return "fuentes del mapa";
  if (url.includes("/sprites/")) return "íconos del mapa";
  if (url.includes("maplibre-gl-worker")) return "worker de MapLibre";
  if (url.includes("maplibre-gl")) return "código de MapLibre";
  return "recurso del mapa";
}

/** Saca mensaje, URL y código de cualquier error de MapLibre, fetch o del navegador. */
export function errorDetails(error: unknown): { message: string; url: string | null; status: number | null } {
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; url?: unknown; status?: unknown; name?: unknown };
    const message = typeof e.message === "string" && e.message ? e.message : String(error);
    const url = typeof e.url === "string" ? e.url : (/(https?:\/\/[^\s'")]+)/.exec(message)?.[1] ?? null);
    const status = typeof e.status === "number" ? e.status : null;
    return { message: typeof e.name === "string" && e.name !== "Error" ? `${e.name}: ${message}` : message, url, status };
  }
  return { message: String(error), url: null, status: null };
}

/** ¿Es un error de red (no hubo respuesta)? Puede ser falta de conexión o un bloqueo. */
export function isNetworkError(error: unknown, status: number | null): boolean {
  if (status === 0) return true;
  const name = (error as { name?: string } | null)?.name;
  const message = String((error as { message?: string } | null)?.message ?? "");
  return name === "TypeError" && /fetch|network|load failed/i.test(message);
}

/**
 * Sin conexión o el mapa no se pudo cargar. Todo el mapa sale de nuestro origen, así que si
 * tampoco responde un pedido a nuestro propio servidor, es falta de conexión.
 */
export async function classifyFailure(error: unknown, status: number | null, probeUrl: string): Promise<MapFailureKind> {
  if (globalThis.navigator?.onLine === false) return "offline";
  if (!isNetworkError(error, status)) return "failed";
  try {
    await fetch(probeUrl, { method: "HEAD", cache: "no-store" });
    return "failed"; // el servidor responde: el problema es otro (bloqueo, archivo roto)
  } catch {
    return "offline";
  }
}
