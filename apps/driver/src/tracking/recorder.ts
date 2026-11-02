/**
 * Convierte fijaciones de ubicación en puntos GPS y los guarda en IndexedDB ANTES de intentar
 * enviarlos (offline primero).
 */
import { distanceMeters, type LocationPoint, locationPoint, type PointSource, uuidv7 } from "@routcontrol/domain";

import type { PositionFix } from "../device/DeviceServices";
import type { DriverDB, PendingPoint } from "../store/db";

export interface RecordingRules {
  minIntervalMs: number;
  minDistanceM: number;
  movingSpeedMs: number;
}

/** ¿Vale la pena guardar esta fijación del seguimiento continuo? (los eventos siempre se guardan) */
export function shouldRecord(last: PositionFix | null, next: PositionFix, rules: RecordingRules): boolean {
  if (!last) return true;
  if (next.timestamp <= last.timestamp) return false; // repetida o fuera de orden
  if (next.timestamp - last.timestamp >= rules.minIntervalMs) return true;
  return distanceMeters(last, next) >= rules.minDistanceM;
}

export function buildPoint(
  fix: PositionFix,
  opts: { source: PointSource; event?: string; battery: number | null; rules: Pick<RecordingRules, "movingSpeedMs">; now?: number },
): LocationPoint {
  return locationPoint.parse({
    point_id: uuidv7(opts.now),
    recorded_at: new Date(fix.timestamp).toISOString(),
    lat: fix.lat,
    lng: fix.lng,
    accuracy: Math.min(fix.accuracy, 100_000),
    speed: fix.speed,
    heading: fix.heading,
    altitude: fix.altitude,
    battery: opts.battery,
    is_moving: fix.speed === null ? null : fix.speed >= opts.rules.movingSpeedMs,
    source: opts.source,
    ...(opts.event ? { event: opts.event } : {}),
  });
}

export type RecordOutcome =
  | { saved: true; point: PendingPoint }
  | { saved: false; reason: "before_workday_start" | "after_workday_end" | "invalid" };

/**
 * Guarda el punto si cae dentro de la jornada (la misma regla que aplica el servidor: los puntos
 * fuera de [inicio, fin] se rechazarían siempre, así que ni se guardan).
 */
export async function recordPoint(
  db: DriverDB,
  workday: { id: string; started_at: string; ended_at?: string | null },
  point: LocationPoint,
  now: number = Date.now(),
): Promise<RecordOutcome> {
  const t = Date.parse(point.recorded_at);
  if (t < Date.parse(workday.started_at)) return { saved: false, reason: "before_workday_start" };
  if (workday.ended_at && t > Date.parse(workday.ended_at)) return { saved: false, reason: "after_workday_end" };
  const pending: PendingPoint = { ...point, workday_id: workday.id, queued_at: now };
  await db.points.put(pending);
  return { saved: true, point: pending };
}
