/** Alertas configurables del panel y configuración de la empresa (ADR-025). */
import { z } from "zod";

export const notificationType = z.enum(["WORKDAY_STARTED", "WORKDAY_ENDED", "NO_SIGNAL", "INCIDENT", "ROUTE_FINISHED"]);
export type NotificationType = z.infer<typeof notificationType>;

export const NOTIFICATION_LABEL: Record<NotificationType, string> = {
  WORKDAY_STARTED: "Inicio de jornada",
  WORKDAY_ENDED: "Fin de jornada",
  NO_SIGNAL: "Sin señal",
  INCIDENT: "Incidencia",
  ROUTE_FINISHED: "Recorrido finalizado",
};

export const notification = z.object({
  id: z.string(),
  type: notificationType,
  title: z.string(),
  body: z.string(),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  unread: z.boolean().optional(),
});
export type AppNotification = z.infer<typeof notification>;

export const notificationList = z.object({ notifications: z.array(notification), unread: z.number() });

export const organizationSettings = z.object({
  alerts: z.object({
    workday_started: z.boolean(),
    workday_ended: z.boolean(),
    no_signal: z.boolean(),
    no_signal_minutes: z.number(),
    incident: z.boolean(),
    route_finished: z.boolean(),
  }),
  reception: z.object({ green: z.number(), yellow: z.number(), min_visits: z.number() }),
  second_attempt: z.object({ insert_max_min: z.number(), end_max_min: z.number() }),
  can_edit: z.boolean(),
});
export type OrganizationSettings = z.infer<typeof organizationSettings>;
