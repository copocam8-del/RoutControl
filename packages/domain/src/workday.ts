/** Contrato de /api/v1/workdays/* y /api/v1/auth/* (etapa 0). */
import { z } from "zod";

import { isoDateTimeWithZone } from "./tracking";

export const workdayStatus = z.enum(["NOT_STARTED", "ACTIVE", "FINISHED", "FORCE_CLOSED", "AUTO_CLOSED"]);
export const trackingMode = z.enum(["CONTINUOUS", "EVENTS_ONLY"]);

export const workday = z.object({
  id: z.uuid(),
  status: workdayStatus,
  tracking_mode: trackingMode,
  date: z.string(),
  started_at: isoDateTimeWithZone,
  ended_at: isoDateTimeWithZone.nullable(),
  device_id: z.uuid(),
});
export type Workday = z.infer<typeof workday>;

export const startWorkdayResponse = z.object({
  workday,
  tracking_token: z.string().min(20),
  tracking_token_expires_at: isoDateTimeWithZone,
});
export type StartWorkdayResponse = z.infer<typeof startWorkdayResponse>;

export const workdayEnvelope = z.object({ workday: workday.nullable() });

/** POST /workdays/{id}/tracking-token: token nuevo para enviar puntos trabados (ADR-010). */
export const trackingTokenRecovery = z.object({
  tracking_token: z.string().min(20),
  tracking_token_expires_at: isoDateTimeWithZone,
});

export const runtime = z.enum(["NATIVE_ANDROID", "NATIVE_IOS", "PWA"]);
export const locationPermission = z.enum(["always", "while_in_use", "denied", "prompt", "unknown"]);
export type LocationPermission = z.infer<typeof locationPermission>;

export const role = z.enum(["OWNER", "ADMIN", "SUPERVISOR", "DRIVER"]);

export const session = z.object({
  access: z.string(),
  user: z.object({ id: z.uuid(), email: z.string(), full_name: z.string() }),
  // is_demo: los datos de demostración se marcan como tales en la interfaz.
  organization: z.object({ id: z.uuid(), name: z.string(), is_demo: z.boolean().default(false) }),
  role,
});
export type Session = z.infer<typeof session>;

export const chooseOrganization = z.object({
  code: z.literal("choose_organization"),
  organizations: z.array(z.object({ id: z.uuid(), name: z.string(), role })),
});
export type ChooseOrganization = z.infer<typeof chooseOrganization>;
