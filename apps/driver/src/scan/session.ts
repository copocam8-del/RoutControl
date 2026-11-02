/**
 * Qué hacer con cada código leído, comparándolo con los paquetes asignados guardados en el
 * teléfono (respuesta inmediata, aunque no haya señal). El servidor confirma después (ADR-014).
 */
import type { PackageStatus } from "@routcontrol/domain";

import type { LocalPackage } from "../store/db";

export type ScanOutcome = "loaded" | "already_loaded" | "duplicate" | "not_assigned" | "resolved";

export const SCAN_LABEL: Record<ScanOutcome, string> = {
  loaded: "Cargado",
  already_loaded: "Ya estaba cargado",
  duplicate: "Ya lo escaneaste",
  not_assigned: "No está asignado a vos",
  resolved: "Ya está resuelto",
};

const LOADABLE: PackageStatus[] = ["ASSIGNED", "FAILED", "RESCHEDULED"];

export function classifyScan(
  code: string,
  packages: LocalPackage[],
  seen: ReadonlySet<string>,
): { outcome: ScanOutcome; pkg: LocalPackage | null } {
  const key = code.trim().toUpperCase();
  if (seen.has(key)) return { outcome: "duplicate", pkg: null };
  const pkg = packages.find((p) => p.tracking_code.trim().toUpperCase() === key) ?? null;
  if (!pkg) return { outcome: "not_assigned", pkg: null };
  if (pkg.status === "IN_ROUTE") return { outcome: "already_loaded", pkg };
  if (LOADABLE.includes(pkg.status)) return { outcome: "loaded", pkg };
  return { outcome: "resolved", pkg };
}
