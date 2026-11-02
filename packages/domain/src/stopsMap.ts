/**
 * Mapa de entregas del día en la app (ADR-019): una "casita" por domicilio con su número de parada
 * y el color de su estado, y la línea de la ruta en el orden sugerido.
 */
import { distanceMeters } from "./geo";
import type { DeliveryPackage, PackageStatus } from "./packages";

/** pending: violeta · delivered: verde · failed: amarillo · second: violeta claro. */
export type StopState = "pending" | "delivered" | "failed" | "second";

export const STOP_STATE: Partial<Record<PackageStatus, StopState>> = {
  CREATED: "pending",
  ASSIGNED: "pending",
  IN_ROUTE: "pending",
  DELIVERED: "delivered",
  FAILED: "failed",
  // Reprogramado: vuelve a salir; se muestra como segundo intento.
  RESCHEDULED: "second",
};

export const STOP_STATE_LABEL: Record<StopState, string> = {
  pending: "Pendiente",
  delivered: "Entregado",
  failed: "No entregado",
  second: "Segundo intento",
};

export interface MapStop {
  id: string;
  /** Número de parada: el orden de la ruta (si hay) y después el de la lista. */
  n: number;
  lat: number;
  lng: number;
  state: StopState;
  /** Para lectores de pantalla y el título del pin. */
  label: string;
}

export type LngLat = [number, number];

/** Orden de la ruta como lo guarda la app: ids en orden y el tramo por calles de cada uno. */
export interface RouteOrder {
  order: readonly string[];
  paths?: Readonly<Record<string, string>>;
}

export interface RouteLeg {
  coords: LngLat[];
  /** Sin tramo por calles (orden a mano): línea recta punteada entre paradas. */
  straight: boolean;
}

/** Ordena como la lista de "Mis paquetes": primero las paradas de la ruta, en su orden. */
export function orderByRoute<T extends { id: string }>(packages: readonly T[], route: RouteOrder | null): T[] {
  if (!route) return [...packages];
  const seq = new Map(route.order.map((id, i) => [id, i]));
  return [...packages].sort((a, b) => (seq.get(a.id) ?? Infinity) - (seq.get(b.id) ?? Infinity));
}

/**
 * Paradas del mapa. Los paquetes sin ubicación no tienen pin, pero sí cuentan para el número
 * (así coincide con la lista). Los cancelados y devueltos no se muestran.
 */
export function mapStops(packages: readonly DeliveryPackage[], route: RouteOrder | null): MapStop[] {
  const out: MapStop[] = [];
  orderByRoute(packages, route).forEach((p, i) => {
    // Un segundo intento aceptado vuelve a "asignado", pero se sigue viendo como segundo intento.
    const pending = p.status === "ASSIGNED" || p.status === "IN_ROUTE";
    const state = pending && p.second_attempt ? "second" : STOP_STATE[p.status];
    if (!state || !p.address.location) return;
    out.push({ id: p.id, n: i + 1, lat: p.address.location.lat, lng: p.address.location.lng, state, label: `Parada ${i + 1}: ${p.address.raw_text}` });
  });
  return out;
}

/** "Pendientes": lo que falta visitar (pendientes y segundos intentos). */
export function filterStops(stops: readonly MapStop[], filter: "pending" | "all"): MapStop[] {
  return filter === "all" ? [...stops] : stops.filter((s) => s.state === "pending" || s.state === "second");
}

/** Polilínea codificada (precisión 5) → [lng, lat]. */
export function decodePolyline(text: string, precision = 5): LngLat[] {
  const out: LngLat[] = [];
  const factor = 10 ** precision;
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < text.length) {
    for (let axis = 0; axis < 2; axis++) {
      let shift = 0;
      let result = 0;
      let b: number;
      do {
        if (index >= text.length) return out;
        b = text.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

/**
 * Línea de la ruta en el orden sugerido: el tramo por calles de cada parada; si no lo tiene
 * (orden a mano), una recta desde la parada anterior. Sin ruta, no hay línea.
 */
export function routeLegs(route: RouteOrder | null, packages: readonly DeliveryPackage[]): RouteLeg[] {
  if (!route) return [];
  const byId = new Map(packages.map((p) => [p.id, p]));
  const legs: RouteLeg[] = [];
  let previous: LngLat | null = null;
  for (const id of route.order) {
    const p = byId.get(id);
    const loc = p?.address.location;
    if (!p || !loc || !STOP_STATE[p.status]) continue;
    const here: LngLat = [loc.lng, loc.lat];
    const encoded = route.paths?.[id];
    const path = encoded ? decodePolyline(encoded) : [];
    if (path.length > 1) legs.push({ coords: path, straight: false });
    else if (previous) legs.push({ coords: [previous, here], straight: true });
    previous = here;
  }
  return legs;
}

/** "a 650 m" / "a 2,4 km". */
export function formatDistance(m: number): string {
  if (m < 1000) return `a ${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `a ${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

export function distanceTo(me: { lat: number; lng: number } | null, stop: { lat: number; lng: number }): number | null {
  return me ? distanceMeters(me, stop) : null;
}
