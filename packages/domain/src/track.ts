/** Contrato de GET /api/v1/workdays y GET /api/v1/workdays/{id}/track (mapa del recorrido). */
import { z } from "zod";

import { isoDateTimeWithZone } from "./tracking";
import { workday } from "./workday";

const lngLat = z.tuple([z.number(), z.number()]);

export const workdayWithDriver = workday.extend({
  driver: z.object({ id: z.uuid(), name: z.string() }),
});
export type WorkdayWithDriver = z.infer<typeof workdayWithDriver>;

export const workdayList = z.object({ workdays: z.array(workdayWithDriver) });

const segmentFeature = z.object({
  type: z.literal("Feature"),
  geometry: z.discriminatedUnion("type", [
    z.object({ type: z.literal("LineString"), coordinates: z.array(lngLat) }),
    z.object({ type: z.literal("Point"), coordinates: lngLat }),
  ]),
  properties: z.object({ segment: z.number() }),
});

const pointFeature = z.object({
  type: z.literal("Feature"),
  geometry: z.object({ type: z.literal("Point"), coordinates: lngLat }),
  properties: z.object({
    recorded_at: isoDateTimeWithZone,
    accuracy_m: z.number(),
    source: z.enum(["BACKGROUND", "FOREGROUND", "EVENT"]),
    event: z.string(),
  }),
});

export const trackGap = z.object({
  from_at: isoDateTimeWithZone,
  to_at: isoDateTimeWithZone,
  seconds: z.number(),
  reason: z.string(),
  from: lngLat.nullable(),
  to: lngLat.nullable(),
});
export type TrackGap = z.infer<typeof trackGap>;

export const workdayTrack = z.object({
  workday: workdayWithDriver,
  segments: z.object({ type: z.literal("FeatureCollection"), features: z.array(segmentFeature) }),
  points: z.object({ type: z.literal("FeatureCollection"), features: z.array(pointFeature) }),
  gaps: z.array(trackGap),
  stats: z.object({
    point_count: z.number(),
    segment_count: z.number(),
    distance_m: z.number(),
    gap_count: z.number(),
    gap_seconds: z.number(),
  }),
});
export type WorkdayTrack = z.infer<typeof workdayTrack>;

/** Líneas punteadas para los huecos que tienen los dos extremos (para dibujarlos distintos del recorrido). */
export function gapLines(track: WorkdayTrack) {
  return {
    type: "FeatureCollection" as const,
    features: track.gaps
      .filter((g): g is TrackGap & { from: [number, number]; to: [number, number] } => g.from !== null && g.to !== null)
      .map((g) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: [g.from, g.to] },
        properties: { seconds: g.seconds, reason: g.reason },
      })),
  };
}

/** Caja que contiene todo el recorrido: [[oeste, sur], [este, norte]], o null si no hay puntos. */
export function trackBounds(track: WorkdayTrack): [[number, number], [number, number]] | null {
  const coords = track.points.features.map((f) => f.geometry.coordinates);
  if (coords.length === 0) return null;
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}
