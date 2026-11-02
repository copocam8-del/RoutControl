/**
 * Cola de lo hecho en la calle (ADR-013): visitas, fotos y comunicaciones, en el orden en que se
 * hicieron (la foto va después de su visita). Mismo criterio que la cola de puntos GPS:
 * - sin red o error del servidor: se reintenta con espera creciente;
 * - un rechazo que reintentar no arregla (400, 403, 404, 409): queda marcado y se informa;
 * - lo que el servidor aceptó se borra del teléfono.
 */
import { ApiError, type ApiClient, NetworkError } from "@routcontrol/api-client";

import { type DriverDB, type OutboxItem } from "../store/db";
import { backoffDelayMs } from "../sync/backoff";
import type { Timers } from "../sync/batchSender";

export interface OutboxStatus {
  pending: number;
  failed: number;
  sending: boolean;
  /** Último error de red/servidor (se reintenta solo). */
  retryAt: number | null;
}

type Api = Pick<ApiClient, "recordVisit" | "uploadEvidence" | "recordCommunication" | "loadPackages" | "saveRoute">;

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class Outbox {
  private status: OutboxStatus = { pending: 0, failed: 0, sending: false, retryAt: null };
  private listeners = new Set<(s: OutboxStatus) => void>();
  private running: Promise<void> | null = null;
  private retryHandle: unknown = null;
  private attempt = 0;
  private readonly timers: Timers;
  private readonly now: () => number;

  constructor(
    private readonly db: DriverDB,
    private readonly api: Api,
    opts: { timers?: Timers; now?: () => number; random?: () => number } = {},
  ) {
    this.timers = opts.timers ?? defaultTimers;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  private readonly random: () => number;

  getStatus(): OutboxStatus {
    return this.status;
  }

  subscribe(listener: (s: OutboxStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async enqueue(items: Array<Omit<OutboxItem, "queued_at">>): Promise<void> {
    const base = this.now();
    // Mismo instante para todo lo de una visita, con un orden estable: visita, foto, comunicación.
    await this.db.outbox.bulkPut(items.map((item, i) => ({ ...item, queued_at: base + i / 1000 })));
    await this.refresh();
    void this.flush();
  }

  async refresh(): Promise<void> {
    const all = await this.db.outbox.toArray();
    this.set({ pending: all.filter((i) => !i.failed).length, failed: all.filter((i) => i.failed).length });
  }

  async failedItems(): Promise<OutboxItem[]> {
    return (await this.db.outbox.toArray()).filter((i) => i.failed);
  }

  flush(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  dispose(): void {
    if (this.retryHandle !== null) this.timers.clearTimeout(this.retryHandle);
    this.retryHandle = null;
  }

  private async run(): Promise<void> {
    if (this.retryHandle !== null) {
      this.timers.clearTimeout(this.retryHandle);
      this.retryHandle = null;
    }
    this.set({ sending: true, retryAt: null });
    try {
      const items = (await this.db.outbox.orderBy("queued_at").toArray()).filter((i) => !i.failed);
      for (const item of items) {
        try {
          await this.send(item);
          await this.db.outbox.delete(item.id);
        } catch (error) {
          if (error instanceof ApiError && [400, 403, 404, 409, 413, 422].includes(error.status)) {
            // La foto de una visita que todavía no llegó (409 visit_not_found) se reintenta después.
            if (error.code === "visit_not_found") throw error;
            await this.db.outbox.update(item.id, { failed: { status: error.status, detail: error.message || "Rechazado" } });
            continue;
          }
          throw error; // sin red, 401 sin sesión o error del servidor: se reintenta todo después
        }
      }
      this.attempt = 0;
    } catch (error) {
      if (!(error instanceof NetworkError) && !(error instanceof ApiError)) throw error;
      const delay = backoffDelayMs(this.attempt++, this.random);
      this.retryHandle = this.timers.setTimeout(() => void this.flush(), delay);
      this.set({ retryAt: this.now() + delay });
    } finally {
      await this.refresh();
      this.set({ sending: false });
    }
  }

  private async send(item: OutboxItem): Promise<void> {
    if (item.kind === "visit") {
      await this.api.recordVisit(item.body as Parameters<Api["recordVisit"]>[0]);
    } else if (item.kind === "evidence") {
      const photo = new Blob([item.photo!.data], { type: item.photo!.type });
      await this.api.uploadEvidence(item.body as Parameters<Api["uploadEvidence"]>[0], photo);
    } else if (item.kind === "route") {
      await this.api.saveRoute((item.body as { package_ids: string[] }).package_ids);
    } else if (item.kind === "load") {
      await this.api.loadPackages((item.body as { tracking_codes: string[] }).tracking_codes);
    } else {
      await this.api.recordCommunication(item.body as Parameters<Api["recordCommunication"]>[0]);
    }
  }

  private set(patch: Partial<OutboxStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }
}
