/** Contrato de GET /api/v1/drivers (panel). */
import { z } from "zod";

import { isoDateTimeWithZone } from "./tracking";
import { workdayStatus } from "./workday";

export const driverSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  employee_code: z.string(),
  vehicle_type: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  membership_status: z.enum(["ACTIVE", "DISABLED"]),
  active_workday: z
    .object({ id: z.uuid(), started_at: isoDateTimeWithZone, last_point_at: isoDateTimeWithZone.nullable() })
    .nullable(),
  last_workday: z
    .object({
      id: z.uuid(),
      date: z.string(),
      started_at: isoDateTimeWithZone,
      ended_at: isoDateTimeWithZone.nullable(),
      status: workdayStatus,
    })
    .nullable(),
});
export type DriverSummary = z.infer<typeof driverSummary>;

export const driverList = z.object({ drivers: z.array(driverSummary) });

/** Minutos sin puntos a partir de los cuales una jornada en curso se muestra "sin señal". */
export const NO_SIGNAL_MINUTES = 10;

/** ¿La jornada en curso lleva más de NO_SIGNAL_MINUTES sin puntos (o nunca mandó uno)? */
export function isWithoutSignal(lastPointAt: string | null, startedAt: string, now: number): boolean {
  const since = Date.parse(lastPointAt ?? startedAt);
  return now - since > NO_SIGNAL_MINUTES * 60_000;
}
