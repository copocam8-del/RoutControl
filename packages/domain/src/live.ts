/** Mapa en vivo del panel (ADR-017): eventos que manda el servidor por WebSocket. */
import { z } from "zod";

import { notification } from "./alerts";

export const livePositionSchema = z.object({
  type: z.literal("position"),
  /** DriverProfile (el mismo id que `/drivers`). */
  driver_id: z.string(),
  workday_id: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  recorded_at: z.string(),
});
export type LivePosition = z.infer<typeof livePositionSchema>;

export const liveMessageSchema = z.discriminatedUnion("type", [
  livePositionSchema,
  z.object({ type: z.literal("ready") }),
  // Alerta del panel (ADR-025).
  z.object({ type: z.literal("notification"), notification }),
  z.object({ type: z.literal("error"), detail: z.string() }),
]);
export type LiveMessage = z.infer<typeof liveMessageSchema>;

/** Une la posición nueva a las conocidas: por repartidor, gana la más reciente (hora del teléfono). */
export function mergeLivePosition(known: Readonly<Record<string, LivePosition>>, next: LivePosition): Record<string, LivePosition> {
  const current = known[next.driver_id];
  if (current && current.workday_id === next.workday_id && Date.parse(current.recorded_at) >= Date.parse(next.recorded_at)) return known as Record<string, LivePosition>;
  return { ...known, [next.driver_id]: next };
}
