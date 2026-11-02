/** La entrega en la calle (ADR-013): resultados de la visita y enlaces externos (sin API de Google). */
import { z } from "zod";

import { isoDateTimeWithZone } from "./tracking";

export const visitOutcome = z.enum([
  "DELIVERED",
  "RECIPIENT_ABSENT",
  "NO_ANSWER",
  "RESCHEDULE_REQUESTED",
  "WRONG_ADDRESS",
  "NO_ACCESS",
  "OTHER",
]);
export type VisitOutcome = z.infer<typeof visitOutcome>;

/** Motivos de "No entregado", en el orden en que se muestran (§7.2). */
export const FAILURE_REASONS: Array<{ outcome: Exclude<VisitOutcome, "DELIVERED">; label: string }> = [
  { outcome: "RECIPIENT_ABSENT", label: "Destinatario ausente" },
  { outcome: "NO_ANSWER", label: "Nadie responde" },
  { outcome: "RESCHEDULE_REQUESTED", label: "Pide reprogramar" },
  { outcome: "WRONG_ADDRESS", label: "Dirección incorrecta" },
  { outcome: "NO_ACCESS", label: "No se puede acceder" },
  { outcome: "OTHER", label: "Otro inconveniente" },
];

export const OUTCOME_LABEL: Record<VisitOutcome, string> = {
  DELIVERED: "Entregado",
  ...Object.fromEntries(FAILURE_REASONS.map((r) => [r.outcome, r.label])),
} as Record<VisitOutcome, string>;

export const visitRecord = z.object({
  id: z.uuid(),
  package_id: z.uuid(),
  driver: z.string(),
  started_at: isoDateTimeWithZone,
  ended_at: isoDateTimeWithZone.nullable(),
  duration_s: z.number().nullable(),
  outcome: z.string(),
  outcome_attribution: z.string(),
  notes: z.string(),
  is_second_attempt: z.boolean(),
  end_location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  evidence: z.array(z.object({ id: z.uuid(), captured_at: isoDateTimeWithZone, mime: z.string(), reason: z.string() })),
});
export type VisitRecord = z.infer<typeof visitRecord>;
export const visitCreated = z.object({ visit: visitRecord, package_status: z.string() });
export const packageVisits = z.object({ visits: z.array(visitRecord) });

export interface Destination {
  raw_text: string;
  location: { lat: number; lng: number } | null;
}

/** Google Maps con indicaciones hasta el destino (enlace universal: abre la app si está instalada). */
export function googleMapsUrl(d: Destination): string {
  const destination = d.location ? `${d.location.lat},${d.location.lng}` : d.raw_text;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

/** Waze navegando hasta el destino (por coordenadas si las hay; si no, buscando la dirección). */
export function wazeUrl(d: Destination): string {
  return d.location
    ? `https://waze.com/ul?ll=${d.location.lat},${d.location.lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(d.raw_text)}&navigate=yes`;
}

/**
 * Número para WhatsApp (wa.me) en formato internacional, pensado para Argentina:
 * - "+54 9 11 5555-0000" → "5491155550000";
 * - "011 15 5555-0000" → "5491155550000" (se quitan el 0 y el 15);
 * - "11 5555-0000" (10 dígitos) → "5491155550000".
 * Devuelve null si no parece un teléfono.
 */
export function whatsappNumber(phone: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("54")) {
    const rest = digits.slice(2);
    digits = rest.startsWith("9") ? `54${rest}` : `549${rest}`;
    return digits.length >= 12 ? digits : null;
  }
  if (digits.startsWith("0")) digits = digits.slice(1);
  // Celular escrito a la antigua: característica + 15 + número (por ejemplo, 11 15 5555 0000).
  const withFifteen = /^(\d{2,4})15(\d{6,8})$/.exec(digits);
  if (withFifteen && withFifteen[1]!.length + withFifteen[2]!.length === 10) digits = withFifteen[1]! + withFifteen[2]!;
  return digits.length === 10 ? `549${digits}` : digits.length >= 11 ? digits : null;
}

export function whatsappUrl(phone: string): string | null {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}` : null;
}

export function telUrl(phone: string): string | null {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return cleaned.replace(/\D/g, "").length >= 6 ? `tel:${cleaned}` : null;
}

/** GET/PUT /route y POST /route/optimize (ADR-015). */
export const route = z.object({
  stops: z.array(
    z.object({
      package_id: z.uuid(),
      sequence: z.number(),
      eta_s: z.number().nullable(),
      distance_m: z.number().nullable(),
      /** Tramo por calles hasta la parada (polilínea codificada); "" si se ordenó a mano (ADR-019). */
      path: z.string().optional(),
    }),
  ),
  source: z.enum(["OPTIMIZED", "MANUAL"]).nullable(),
  total_eta_s: z.number().nullable(),
  total_distance_m: z.number().nullable(),
});
export type Route = z.infer<typeof route>;

/** GET /deliveries (panel): las visitas del día con su paquete. */
export const deliveryRecord = visitRecord.extend({
  package: z.object({
    id: z.uuid(),
    tracking_code: z.string(),
    recipient_name: z.string(),
    status: z.string(),
    address: z.object({ raw_text: z.string(), location: z.object({ lat: z.number(), lng: z.number() }).nullable() }).passthrough(),
  }),
});
export type DeliveryRecord = z.infer<typeof deliveryRecord>;
export const deliveryList = z.object({ date: z.string(), deliveries: z.array(deliveryRecord) });

/** GET /incidents (panel). */
export const incident = z.object({
  id: z.uuid(),
  type: z.string(),
  description: z.string(),
  status: z.enum(["OPEN", "RESOLVED"]),
  occurred_at: isoDateTimeWithZone,
  resolved_at: isoDateTimeWithZone.nullable(),
  resolved_by: z.string().nullable(),
  driver: z.string().nullable(),
  visit_id: z.string().nullable(),
  evidence: z.array(z.object({ id: z.uuid() })),
  package: z.object({ id: z.uuid(), tracking_code: z.string(), recipient_name: z.string(), status: z.string(), address: z.string() }),
});
export type Incident = z.infer<typeof incident>;
export const incidentList = z.object({ incidents: z.array(incident) });
export const incidentEnvelope = z.object({ incident });
