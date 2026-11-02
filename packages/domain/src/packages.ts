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

export const deliveryPackage = z.object({
  id: z.uuid(),
  tracking_code: z.string(),
  source: z.enum(["MANUAL", "IMPORT"]),
  status: packageStatus,
  recipient_name: z.string(),
  recipient_phone: z.string(),
  notes: z.string(),
  address,
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
