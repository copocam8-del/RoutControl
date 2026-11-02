/**
 * Cola de envío de puntos GPS (§5.2 y ADR-003).
 *
 * - Envía los puntos pendientes de cada jornada en lotes, con el TrackingToken de esa jornada.
 * - Borra del teléfono lo que el servidor "resolvió": aceptados, duplicados y rechazados. Lo que
 *   no figura en la respuesta queda pendiente.
 * - Sin red o con error del servidor: reintenta con espera creciente.
 * - 401/403: el token ya no sirve. Se pide uno nuevo con la sesión del repartidor
 *   (POST /workdays/{id}/tracking-token, ADR-010) y se reintenta. Si el servidor no lo da (pasó la
 *   gracia, dispositivo dado de baja), los puntos quedan guardados y se muestra el error.
 */
import { settledPointIds } from "@routcontrol/domain";

import { ApiError, type ApiClient, NetworkError } from "../api/client";
import { addLog, type DriverDB, type LocalWorkday, type PendingPoint } from "../store/db";
import { backoffDelayMs } from "./backoff";

export type SyncStatus =
  | { kind: "idle"; pending: number; lastSyncAt: number | null }
  | { kind: "syncing"; pending: number; lastSyncAt: number | null }
  | { kind: "synced"; pending: 0; lastSyncAt: number | null }
  | { kind: "offline"; pending: number; lastSyncAt: number | null; nextRetryAt: number | null }
  | { kind: "error"; pending: number; lastSyncAt: number | null; message: string; nextRetryAt: number | null };

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BatchSenderOptions {
  db: DriverDB;
  api: Pick<ApiClient, "postBatch"> & Partial<Pick<ApiClient, "recoverTrackingToken">>;
  batchSize: number;
  now?: () => number;
  timers?: Timers;
  isOnline?: () => boolean;
  random?: () => number;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

const RECOVERY_REFUSED_MESSAGE =
  "Hay ubicaciones que no se van a poder enviar: pasó el plazo de la jornada o el teléfono fue dado de baja.";

/** El servidor no da un token nuevo: no tiene sentido reintentar. */
class RecoveryRefused extends Error {}

export class BatchSender {
  private status: SyncStatus = { kind: "idle", pending: 0, lastSyncAt: null };
  private listeners = new Set<(s: SyncStatus) => void>();
  private running: Promise<SyncStatus> | null = null;
  private retryHandle: unknown = null;
  private debounceHandle: unknown = null;
  private attempt = 0;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly isOnline: () => boolean;

  constructor(private readonly opts: BatchSenderOptions) {
    this.now = opts.now ?? Date.now;
    this.timers = opts.timers ?? defaultTimers;
    this.isOnline = opts.isOnline ?? (() => true);
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Recalcula la cantidad pendiente (por ejemplo, después de guardar un punto). */
  async refreshPending(): Promise<void> {
    const pending = await this.opts.db.points.count();
    this.setStatus({ ...this.status, pending } as SyncStatus);
  }

  /** Envía pronto, juntando los puntos que lleguen en los próximos `ms`. */
  flushSoon(ms: number): void {
    if (this.debounceHandle !== null) return;
    this.debounceHandle = this.timers.setTimeout(() => {
      this.debounceHandle = null;
      void this.flush();
    }, ms);
  }

  /** Envía todo lo pendiente. Llamadas simultáneas comparten el mismo envío. */
  flush(): Promise<SyncStatus> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  dispose(): void {
    if (this.retryHandle !== null) this.timers.clearTimeout(this.retryHandle);
    if (this.debounceHandle !== null) this.timers.clearTimeout(this.debounceHandle);
    this.listeners.clear();
  }

  private async run(): Promise<SyncStatus> {
    const { db } = this.opts;
    if (this.retryHandle !== null) {
      this.timers.clearTimeout(this.retryHandle);
      this.retryHandle = null;
    }
    const lastSyncAt = this.status.lastSyncAt;
    let pending = await db.points.count();
    if (pending === 0) return this.setStatus({ kind: "synced", pending: 0, lastSyncAt });

    this.setStatus({ kind: "syncing", pending, lastSyncAt });
    const workdays = await db.workdays.toArray();
    let tokenError: string | null = null;

    for (let workday of workdays) {
      if (workday.recovery_failed) {
        tokenError = TOKEN_INVALID_MESSAGE;
        continue;
      }
      try {
        if (workday.token_invalid) workday = await this.recoverToken(workday);
        await this.sendWorkday(workday);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403) && !workday.token_invalid) {
          // El token ya no sirve: se marca y se pide uno nuevo en esta misma pasada.
          await db.workdays.update(workday.id, { token_invalid: true });
          await addLog(db, { at: this.now(), kind: "token_invalid", detail: `Jornada ${workday.id}` });
          try {
            await this.sendWorkday(await this.recoverToken({ ...workday, token_invalid: true }));
            continue;
          } catch (retryError) {
            error = retryError;
          }
        }
        if (error instanceof RecoveryRefused) {
          tokenError = error.message;
          continue;
        }
        return this.scheduleRetry(error);
      }
    }

    this.attempt = 0;
    pending = await db.points.count();
    const syncedAt = this.now();
    if (tokenError && pending > 0) {
      return this.setStatus({ kind: "error", pending, lastSyncAt: syncedAt, message: tokenError, nextRetryAt: null });
    }
    return this.setStatus(
      pending === 0 ? { kind: "synced", pending: 0, lastSyncAt: syncedAt } : { kind: "idle", pending, lastSyncAt: syncedAt },
    );
  }

  /**
   * Pide un token nuevo para la jornada (ADR-010). Si el servidor lo niega (gracia vencida,
   * dispositivo o jornada inexistente), marca la jornada para no volver a intentar.
   */
  private async recoverToken(workday: LocalWorkday): Promise<LocalWorkday> {
    const { db, api } = this.opts;
    if (!api.recoverTrackingToken) throw new RecoveryRefused(TOKEN_INVALID_MESSAGE);
    try {
      const fresh = await api.recoverTrackingToken(workday.id);
      const updated: LocalWorkday = {
        ...workday,
        tracking_token: fresh.tracking_token,
        tracking_token_expires_at: fresh.tracking_token_expires_at,
        token_invalid: false,
      };
      await db.workdays.put(updated);
      await addLog(db, { at: this.now(), kind: "batch_ok", detail: `Token recuperado para la jornada ${workday.id}` });
      return updated;
    } catch (error) {
      if (error instanceof ApiError && [403, 404, 409].includes(error.status)) {
        await db.workdays.update(workday.id, { recovery_failed: true });
        const message = RECOVERY_REFUSED_MESSAGE;
        await addLog(db, { at: this.now(), kind: "token_invalid", detail: `Jornada ${workday.id}: ${error.message || message}` });
        throw new RecoveryRefused(message);
      }
      throw error; // sin red o error del servidor: se reintenta más tarde
    }
  }

  private async sendWorkday(workday: LocalWorkday): Promise<void> {
    const { db, api, batchSize } = this.opts;
    // Los puntos de una jornada se mandan en el orden en que se guardaron.
    for (;;) {
      const batch = await db.points
        .where("[workday_id+queued_at]")
        .between([workday.id, -Infinity], [workday.id, Infinity])
        .limit(batchSize)
        .toArray();
      if (batch.length === 0) return;

      const response = await api.postBatch(workday.tracking_token, {
        sent_at: new Date(this.now()).toISOString(),
        points: batch.map(toWire),
      });
      const settled = settledPointIds(response);
      await db.points.bulkDelete(batch.map((p) => p.point_id).filter((id) => settled.has(id)));
      for (const r of response.rejected) {
        await addLog(db, { at: this.now(), kind: "rejected", detail: `${r.id}: ${r.reason} — ${r.detail}` });
      }
      await addLog(db, {
        at: this.now(),
        kind: "batch_ok",
        detail: `${response.accepted.length} aceptados, ${response.duplicates.length} duplicados, ${response.rejected.length} rechazados`,
      });
      this.setStatus({ ...this.status, pending: await db.points.count() } as SyncStatus);
      // Si el servidor no resolvió ningún punto del lote, no tiene sentido insistir en un bucle.
      if (!batch.some((p) => settled.has(p.point_id))) throw new Error("El servidor no confirmó ningún punto del lote");
    }
  }

  private async scheduleRetry(error: unknown): Promise<SyncStatus> {
    const delay = backoffDelayMs(this.attempt, this.opts.random);
    this.attempt += 1;
    const nextRetryAt = this.now() + delay;
    this.retryHandle = this.timers.setTimeout(() => {
      this.retryHandle = null;
      void this.flush();
    }, delay);
    const pending = await this.opts.db.points.count();
    const { lastSyncAt } = this.status;
    const offline = error instanceof NetworkError || !this.isOnline();
    await addLog(this.opts.db, { at: this.now(), kind: "batch_error", detail: String(error instanceof Error ? error.message : error) });
    return this.setStatus(
      offline
        ? { kind: "offline", pending, lastSyncAt, nextRetryAt }
        : {
            kind: "error",
            pending,
            lastSyncAt,
            nextRetryAt,
            message: error instanceof Error ? error.message : "Error al sincronizar",
          },
    );
  }

  private setStatus(status: SyncStatus): SyncStatus {
    this.status = status;
    for (const listener of this.listeners) listener(status);
    return status;
  }
}

export const TOKEN_INVALID_MESSAGE =
  "El servidor ya no acepta puntos de esta jornada (token vencido o dispositivo desactivado). Avisale a tu supervisor.";

function toWire(point: PendingPoint) {
  const { workday_id: _w, queued_at: _q, ...wire } = point;
  return wire;
}
