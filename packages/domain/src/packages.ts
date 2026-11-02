/** Contratos de paquetes (§7, §9): GET/POST /packages, asignación, estados y trazabilidad. */
import { z } from "zod";

import { isoDateTimeWithZone } from "./tracking";

export const packageStatus = z.enum(["CREATED", "ASSIGNED", "IN_ROUTE", "DELIVERED", "FAILED", "RESCHEDULED", "RETURNED", "CANCELLED"]);
export type PackageStatus = z.infer<typeof packageStatus>;

/** Nombre del estado para mostrar, igual que en el backend. */
export const PACKAGE_STATUS_LABEL: Record<PackageStatus, string> = {
  CREATED: "Creado",
  ASSIGNED: "Asignado",
  IN_ROUTE: "En camino",
  DELIVERED: "Entregado",
  FAILED: "No entregado",
  RESCHEDULED: "Reprogramado",
  RETURNED: "Devuelto",
  CANCELLED: "Cancelado",
};

export const FINAL_PACKAGE_STATUSES: PackageStatus[] = ["DELIVERED", "RETURNED", "CANCELLED"];

export const address = z.object({
  id: z.uuid(),
  raw_text: z.string(),
  street: z.string(),
  number: z.string(),
  floor_unit: z.string(),
  locality: z.string(),
  province: z.string(),
  postal_code: z.string(),
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
});
export type Address = z.infer<typeof address>;

/** Indicador de recepción del domicilio (§7.3, ADR-022): informativo, nunca bloquea una entrega. */
export const receptionLevel = z.enum(["green", "yellow", "red", "gray"]);
export type ReceptionLevel = z.infer<typeof receptionLevel>;
export const reception = z.object({ level: receptionLevel, score: z.number().nullable(), computable: z.number() });
export type Reception = z.infer<typeof reception>;

export const RECEPTION_LABEL: Record<ReceptionLevel, string> = {
  green: "Suele recibir",
  yellow: "A veces no está",
  red: "Suele no estar",
  gray: "Sin historial",
};

export const deliveryPackage = z.object({
  id: z.uuid(),
  tracking_code: z.string(),
  source: z.enum(["MANUAL", "IMPORT"]),
  status: packageStatus,
  recipient_name: z.string(),
  recipient_phone: z.string(),
  notes: z.string(),
  address,
  // Opcional: los paquetes guardados en el teléfono antes de la etapa 2 no lo tienen.
  reception: reception.optional(),
  /** Segundo intento aceptado, con la franja que dio el destinatario (ADR-023). */
  second_attempt: z
    .object({ window_start: z.string().nullable(), window_end: z.string().nullable(), note: z.string() })
    .nullable()
    .optional(),
  assigned_driver: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  assigned_at: isoDateTimeWithZone.nullable(),
  version: z.number().int().positive(),
  created_at: isoDateTimeWithZone,
  updated_at: isoDateTimeWithZone,
});
export type DeliveryPackage = z.infer<typeof deliveryPackage>;

export const packageEnvelope = z.object({ package: deliveryPackage });
export const packageList = z.object({ packages: z.array(deliveryPackage) });

export const packageEvent = z.object({
  id: z.uuid(),
  type: z.enum(["created", "updated", "assigned", "unassigned", "status_changed"]),
  from_status: z.string(),
  to_status: z.string(),
  actor: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  occurred_at: isoDateTimeWithZone,
});
export type PackageEvent = z.infer<typeof packageEvent>;
export const packageEvents = z.object({ events: z.array(packageEvent) });

export const bulkAssignResult = z.object({
  assigned: z.array(z.uuid()),
  failed: z.array(z.object({ id: z.string(), code: z.string(), detail: z.string() })),
});

export interface AddressInput {
  raw_text?: string;
  street?: string;
  number?: string;
  floor_unit?: string;
  locality?: string;
  province?: string;
  postal_code?: string;
  lat?: number | null;
  lng?: number | null;
}

export interface PackageInput {
  tracking_code: string;
  recipient_name?: string;
  recipient_phone?: string;
  notes?: string;
  address: AddressInput;
  driver_id?: string | null;
}

/** GET /addresses/{id} (panel): historial del domicilio. */
export const addressHistory = z.object({
  address,
  reception: reception.extend({ delivered: z.number(), recipient_failures: z.number(), last_visit_at: z.string().nullable() }),
  thresholds: z.object({ green: z.number(), yellow: z.number(), min_visits: z.number() }),
  visits: z.array(
    z.object({
      id: z.string(),
      started_at: z.string(),
      duration_s: z.number().nullable(),
      outcome: z.string(),
      outcome_attribution: z.string(),
      is_second_attempt: z.boolean(),
      voided: z.boolean(),
      notes: z.string(),
      driver: z.string(),
      package: z.object({ id: z.string(), tracking_code: z.string() }),
      evidence: z.array(z.object({ id: z.string() })),
    }),
  ),
  packages: z.array(z.object({ id: z.string(), tracking_code: z.string(), status: packageStatus, recipient_name: z.string() })),
});
export type AddressHistory = z.infer<typeof addressHistory>;

/** Segundo intento con sugerencia de desvío (panel, ADR-023). */
export const secondAttemptSuggestion = z.enum(["INSERT", "END", "NEXT_DAY"]);
export type SecondAttemptSuggestion = z.infer<typeof secondAttemptSuggestion>;
export const SECOND_ATTEMPT_LABEL: Record<SecondAttemptSuggestion, string> = {
  INSERT: "Insertarlo en la ruta de hoy",
  END: "Al final de la ruta de hoy",
  NEXT_DAY: "Mañana",
};
export const secondAttempt = z.object({
  id: z.string(),
  package: z.object({ id: z.string(), tracking_code: z.string(), recipient_name: z.string(), address: z.string(), status: packageStatus }),
  requested_at: z.string(),
  window_start: z.string().nullable(),
  window_end: z.string().nullable(),
  note: z.string(),
  distance_m: z.number().nullable(),
  detour_s: z.number().nullable(),
  pending_count: z.number(),
  insert_position: z.number().nullable(),
  suggestion: secondAttemptSuggestion,
  suggestion_reason: z.string(),
  decision: z.enum(["PENDING", "ACCEPTED", "REJECTED"]),
  placement: secondAttemptSuggestion.nullable(),
  decided_at: z.string().nullable(),
});
export type SecondAttempt = z.infer<typeof secondAttempt>;
