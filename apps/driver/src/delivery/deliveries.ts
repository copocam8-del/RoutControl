/**
 * "Mis paquetes" y la visita en curso (ADR-013).
 *
 * - La lista viene del servidor y se guarda en el teléfono: sin señal se sigue viendo la última.
 * - Lo hecho en la calle va primero al teléfono (Outbox) y el estado del paquete se actualiza en
 *   el teléfono enseguida; cuando el servidor confirma, su lista vuelve a mandar.
 * - La visita en curso (con su cronómetro) se guarda en el teléfono: si se cierra la app, sigue.
 */
import { type DeliveryPackage, type PackageStatus, uuidv7, type VisitOutcome } from "@routcontrol/domain";

import type { ApiClient } from "../api/client";
import type { DeviceServices } from "../device/DeviceServices";
import { type DriverDB, getMeta, type LocalPackage, setMeta } from "../store/db";
import type { WorkdayController } from "../tracking/workdayController";
import type { Outbox } from "./outbox";

export interface ActiveVisit {
  id: string;
  package_id: string;
  started_at: string;
  start_location: { lat: number; lng: number; accuracy: number } | null;
}

export interface DeliveriesState {
  status: "loading" | "ready" | "error";
  packages: LocalPackage[];
  /** La lista mostrada es la guardada en el teléfono (no se pudo actualizar). */
  offline: boolean;
  updatedAt: number | null;
  activeVisit: ActiveVisit | null;
  error: string | null;
}

export interface VisitResult {
  outcome: VisitOutcome;
  notes?: string;
  attribution?: "RECIPIENT" | "LOGISTIC" | null;
  photo?: { data: ArrayBuffer; type: string } | null;
}

const ACTIVE_VISIT_KEY = "activeVisit";

const RESULT_STATUS: Partial<Record<VisitOutcome, PackageStatus>> = {
  DELIVERED: "DELIVERED",
  RESCHEDULE_REQUESTED: "RESCHEDULED",
};

/** Pendientes primero (en el orden de la ruta, cuando exista), después los resueltos. */
export const PENDING_STATUSES: PackageStatus[] = ["ASSIGNED", "IN_ROUTE", "FAILED", "RESCHEDULED"];

export class Deliveries {
  private state: DeliveriesState = {
    status: "loading",
    packages: [],
    offline: false,
    updatedAt: null,
    activeVisit: null,
    error: null,
  };
  private listeners = new Set<(s: DeliveriesState) => void>();

  constructor(
    private readonly deps: {
      db: DriverDB;
      api: Pick<ApiClient, "listPackages">;
      outbox: Outbox;
      device: DeviceServices;
      workday: Pick<WorkdayController, "getState">;
      now?: () => number;
    },
  ) {}

  private get now() {
    return this.deps.now ?? Date.now;
  }

  getState(): DeliveriesState {
    return this.state;
  }

  subscribe(listener: (s: DeliveriesState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Lee la lista guardada y la visita en curso; después intenta actualizar desde el servidor. */
  async load(): Promise<void> {
    const { db } = this.deps;
    const [cached, active] = await Promise.all([db.packages.toArray(), getMeta<ActiveVisit>(db, ACTIVE_VISIT_KEY)]);
    if (cached.length) this.set({ status: "ready", packages: await this.withLocalStatus(cached), offline: true });
    this.set({ activeVisit: active ?? null });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const { db, api } = this.deps;
    try {
      const fresh = await api.listPackages();
      await db.transaction("rw", db.packages, async () => {
        await db.packages.clear();
        await db.packages.bulkPut(fresh);
      });
      this.set({ status: "ready", packages: await this.withLocalStatus(fresh), offline: false, updatedAt: this.now(), error: null });
    } catch (error) {
      if (this.state.packages.length) {
        this.set({ status: "ready", offline: true });
      } else {
        this.set({ status: "error", error: error instanceof Error ? error.message : "No se pudo cargar la lista." });
      }
    }
  }

  /** Lo hecho en la calle que todavía no llegó al servidor pisa el estado de la lista. */
  private async withLocalStatus(packages: DeliveryPackage[]): Promise<LocalPackage[]> {
    const pending = (await this.deps.db.outbox.orderBy("queued_at").toArray()).filter((i) => !i.failed);
    const local = new Map<string, PackageStatus>();
    for (const item of pending) {
      if (item.kind === "load") {
        const codes = new Set((item.body.tracking_codes as string[]) ?? []);
        for (const p of packages) if (codes.has(p.tracking_code) && p.status !== "DELIVERED") local.set(p.id, "IN_ROUTE");
      } else if (item.kind === "visit") {
        local.set(item.package_id, RESULT_STATUS[item.body.outcome as VisitOutcome] ?? "FAILED");
      }
    }
    return packages.map((p) => (local.has(p.id) ? { ...p, status: local.get(p.id)! } : p));
  }

  /** "Llegué: iniciar visita". Hace falta la jornada iniciada (GPS solo durante la jornada). */
  async startVisit(pkg: LocalPackage): Promise<ActiveVisit> {
    const phase = this.deps.workday.getState().phase;
    if (phase !== "active") throw new Error("Iniciá la jornada para registrar visitas.");
    if (this.state.activeVisit && this.state.activeVisit.package_id !== pkg.id) {
      throw new Error("Ya tenés una visita en curso: terminala primero.");
    }
    if (this.state.activeVisit) return this.state.activeVisit;
    const visit: ActiveVisit = {
      id: uuidv7(this.now()),
      package_id: pkg.id,
      started_at: new Date(this.now()).toISOString(),
      start_location: await this.quickLocation(),
    };
    await setMeta(this.deps.db, ACTIVE_VISIT_KEY, visit);
    this.set({ activeVisit: visit });
    return visit;
  }

  async cancelVisit(): Promise<void> {
    await this.deps.db.meta.delete(ACTIVE_VISIT_KEY);
    this.set({ activeVisit: null });
  }

  /** Cierra la visita con su resultado: queda en el teléfono y se envía cuando haya señal. */
  async finishVisit(result: VisitResult): Promise<void> {
    const visit = this.state.activeVisit;
    if (!visit) throw new Error("No hay una visita en curso.");
    const { db, outbox, workday } = this.deps;
    const endedAt = new Date(Math.max(this.now(), Date.parse(visit.started_at))).toISOString();
    const endLocation = await this.quickLocation();
    const wd = workday.getState().workday;
    const items: Parameters<Outbox["enqueue"]>[0] = [
      {
        id: visit.id,
        kind: "visit",
        package_id: visit.package_id,
        body: {
          id: visit.id,
          package_id: visit.package_id,
          workday_id: wd?.id ?? null,
          started_at: visit.started_at,
          ended_at: endedAt,
          outcome: result.outcome,
          attribution: result.attribution ?? null,
          notes: result.notes ?? "",
          start_location: visit.start_location,
          end_location: endLocation,
        },
      },
    ];
    if (result.photo) {
      const photoId = uuidv7(this.now());
      items.push({
        id: photoId,
        kind: "evidence",
        package_id: visit.package_id,
        body: {
          id: photoId,
          package_id: visit.package_id,
          visit_id: visit.id,
          captured_at: endedAt,
          reason: result.outcome === "DELIVERED" ? "entrega" : "no_entregado",
          lat: endLocation?.lat ?? null,
          lng: endLocation?.lng ?? null,
        },
        photo: result.photo,
      });
    }
    await outbox.enqueue(items);
    await db.meta.delete(ACTIVE_VISIT_KEY);
    const status = RESULT_STATUS[result.outcome] ?? "FAILED";
    this.set({
      activeVisit: null,
      packages: this.state.packages.map((p) => (p.id === visit.package_id ? { ...p, status } : p)),
    });
  }

  /**
   * Carga con escaneo (ADR-014): los paquetes quedan "En camino" en el teléfono enseguida y la
   * carga se envía al servidor por la cola (sirve aunque en el depósito no haya señal).
   */
  async markLoaded(pkgs: LocalPackage[]): Promise<void> {
    if (!pkgs.length) return;
    const ids = new Set(pkgs.map((p) => p.id));
    const id = uuidv7(this.now());
    await this.deps.outbox.enqueue([
      { id, kind: "load", package_id: pkgs[0]!.id, body: { tracking_codes: pkgs.map((p) => p.tracking_code) } },
    ]);
    const packages = this.state.packages.map((p) => (ids.has(p.id) ? { ...p, status: "IN_ROUTE" as const } : p));
    await this.deps.db.packages.bulkPut(packages.filter((p) => ids.has(p.id)));
    this.set({ packages });
  }

  /** Registra que se tocó "Llamar" o "WhatsApp" (para el historial del paquete). */
  async logContact(pkg: LocalPackage, channel: "PHONE" | "WHATSAPP"): Promise<void> {
    const id = uuidv7(this.now());
    await this.deps.outbox.enqueue([
      { id, kind: "communication", package_id: pkg.id, body: { id, package_id: pkg.id, channel, started_at: new Date(this.now()).toISOString() } },
    ]);
  }

  /** Ubicación de la visita, sin hacer esperar: si no llega en 5 s, sigue sin ella. */
  private async quickLocation(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
    try {
      const fix = await this.deps.device.location.current({ timeoutMs: 5_000 });
      return { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy };
    } catch {
      return null;
    }
  }

  private set(patch: Partial<DeliveriesState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }
}
