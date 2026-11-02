/** Contratos de la importación de paquetes (ADR-012). */
import { z } from "zod";

import { isoDateTimeWithZone } from "./tracking";

export const importField = z.object({ key: z.string(), label: z.string(), required: z.boolean() });
export const importRowError = z.object({ row: z.number(), field: z.string(), message: z.string() });
export type ImportRowError = z.infer<typeof importRowError>;

export const importJob = z.object({
  id: z.uuid(),
  filename: z.string(),
  status: z.enum(["UPLOADED", "DONE"]),
  headers: z.array(z.string()),
  sample: z.array(z.array(z.string())),
  total_rows: z.number(),
  column_mapping: z.record(z.string(), z.string().nullable()),
  suggested_mapping: z.record(z.string(), z.string().nullable()),
  fields: z.array(importField),
  ok_rows: z.number(),
  error_rows: z.number(),
  errors: z.array(importRowError),
  created_at: isoDateTimeWithZone,
  finished_at: isoDateTimeWithZone.nullable(),
});
export type ImportJob = z.infer<typeof importJob>;
export const importEnvelope = z.object({ import: importJob });

export const importPreview = z.object({
  summary: z.object({ total_rows: z.number(), ok_rows: z.number(), error_rows: z.number() }),
  rows: z.array(
    z.object({ row: z.number(), ok: z.boolean(), values: z.record(z.string(), z.unknown()), errors: z.array(z.object({ field: z.string(), message: z.string() })) }),
  ),
  errors: z.array(importRowError),
});
export type ImportPreview = z.infer<typeof importPreview>;

/** Mapeo: campo de RouteControl → columna del archivo (o null si no se usa). */
export type ColumnMapping = Record<string, string | null>;
