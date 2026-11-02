/** Informes por repartidor y por empresa (ADR-024). */
import { z } from "zod";

export const reportPeriodKind = z.enum(["day", "week", "fortnight", "month", "range"]);
export type ReportPeriodKind = z.infer<typeof reportPeriodKind>;

export const REPORT_PERIOD_LABEL: Record<ReportPeriodKind, string> = {
  day: "Día",
  week: "Semana",
  fortnight: "Quincena",
  month: "Mes",
  range: "Rango",
};

const metrics = z.object({
  workdays: z.number(),
  hours: z.number(),
  distance_km: z.number(),
  events_only_workdays: z.number(),
  no_signal_minutes: z.number(),
  visits: z.number(),
  delivered: z.number(),
  failed: z.number(),
  failed_recipient: z.number(),
  failed_logistic: z.number(),
  second_attempts: z.number(),
  delivery_rate: z.number().nullable(),
  avg_visit_minutes: z.number().nullable(),
});
export type ReportMetrics = z.infer<typeof metrics>;

export const report = z.object({
  period: z.object({ kind: reportPeriodKind, from: z.string(), to: z.string(), label: z.string() }),
  drivers: z.array(metrics.extend({ driver: z.object({ id: z.string(), name: z.string() }) })),
  total: metrics,
});
export type Report = z.infer<typeof report>;

export interface ReportQuery {
  period: ReportPeriodKind;
  /** Fecha de referencia (AAAA-MM-DD); en un rango, la inicial. */
  date?: string;
  /** Solo en un rango: la fecha final. */
  to?: string;
  driver?: string;
}

/** Corre la fecha de referencia un período para atrás (-1) o adelante (+1). */
export function shiftReportDate(kind: ReportPeriodKind, date: string, delta: -1 | 1): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (kind === "day") d.setUTCDate(d.getUTCDate() + delta);
  else if (kind === "week") d.setUTCDate(d.getUTCDate() + 7 * delta);
  else if (kind === "month") d.setUTCMonth(d.getUTCMonth() + delta, 1);
  else if (kind === "fortnight") {
    if (delta > 0) d.getUTCDate() <= 15 ? d.setUTCDate(16) : d.setUTCMonth(d.getUTCMonth() + 1, 1);
    else d.getUTCDate() > 15 ? d.setUTCDate(1) : d.setUTCMonth(d.getUTCMonth() - 1, 16);
  }
  return d.toISOString().slice(0, 10);
}
