/**
 * Contrato de POST /api/v1/tracking/batch (ver docs/adr/ADR-003-ingesta-gps.md).
 * El backend valida lo mismo del lado servidor: esto es para que el teléfono no guarde ni mande
 * puntos que el servidor va a rechazar siempre.
 */
import { z } from "zod";

/** ISO 8601 con zona horaria explícita (Z u offset): el servidor rechaza fechas sin zona. */
export const isoDateTimeWithZone = z.iso.datetime({ offset: true });

export const pointSource = z.enum(["BACKGROUND", "FOREGROUND", "EVENT"]);
export type PointSource = z.infer<typeof pointSource>;

export const locationPoint = z.object({
  point_id: z.uuid(),
  recorded_at: isoDateTimeWithZone,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000),
  speed: z.number().min(0).max(150).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  altitude: z.number().min(-1_000).max(10_000).nullable().optional(),
  battery: z.number().min(0).max(1).nullable().optional(),
  is_moving: z.boolean().nullable().optional(),
  source: pointSource.default("FOREGROUND"),
  event: z.string().max(40).optional(),
});
export type LocationPoint = z.infer<typeof locationPoint>;

export const MAX_BATCH_SIZE = 500;

export const trackingBatchRequest = z.object({
  sent_at: isoDateTimeWithZone.optional(),
  points: z.array(locationPoint).max(MAX_BATCH_SIZE),
});
export type TrackingBatchRequest = z.infer<typeof trackingBatchRequest>;

/** Motivos de rechazo estables. `invalid:<campo>` se agrega dinámicamente. */
export const REJECTION_REASONS = [
  "before_workday_start",
  "after_workday_end",
  "recorded_in_future",
] as const;

export const rejectedPoint = z.object({
  id: z.string(),
  reason: z.string(),
  detail: z.string(),
});

export const trackingBatchResponse = z.object({
  accepted: z.array(z.string()),
  duplicates: z.array(z.string()),
  rejected: z.array(rejectedPoint),
  server_time: isoDateTimeWithZone,
});
export type TrackingBatchResponse = z.infer<typeof trackingBatchResponse>;

/**
 * Qué puede borrar el teléfono después de un lote: los aceptados, los duplicados (ya estaban en
 * el servidor) y los rechazados (no se van a aceptar nunca). Lo que no figura en la respuesta
 * queda pendiente y se reintenta.
 */
export function settledPointIds(response: TrackingBatchResponse): Set<string> {
  return new Set([...response.accepted, ...response.duplicates, ...response.rejected.map((r) => r.id)]);
}
