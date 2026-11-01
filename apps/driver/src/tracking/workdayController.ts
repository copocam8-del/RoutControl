/**
 * Jornada en la PWA (§4.2, modo EVENTS_ONLY):
 *   - ubicación garantizada en cada evento (inicio y fin de jornada);
 *   - recorrido mientras la app está abierta y visible; al pasar a segundo plano el navegador
 *     corta la ubicación, y ese hueco queda registrado del lado del servidor;
 *   - nada se registra fuera de la jornada.
 *
 * Iniciar y finalizar son idempotentes: el id de la jornada y la hora de fin se guardan en el
 * teléfono antes de llamar al servidor, así un reintento repite exactamente la misma operación.
 */
import { uuidv7, type Workday } from "@routcontrol/domain";

import { ApiError, type ApiClient, NetworkError } from "../api/client";
import type { AppConfig } from "../config";
import { type DeviceServices, LocationError, type PositionFix } from "../device/DeviceServices";
import { activeWorkday, type DriverDB, getMeta, type LocalWorkday, setMeta } from "../store/db";
import type { BatchSender } from "../sync/batchSender";
import { buildPoint, recordPoint, shouldRecord } from "./recorder";

export type GpsState = "off" | "watching" | "paused" | "denied" | "error";

export interface WorkdayState {
  phase: "loading" | "idle" | "starting" | "active" | "ending";
  workday: LocalWorkday | null;
  gps: GpsState;
  lastFixAt: number | null;
  /** Mensaje para mostrar (en español). */
  error: string | null;
  /** El servidor ya tiene una jornada activa que este teléfono no conoce. */
  conflict: Workday | null;
}

const PENDING_START_KEY = "pendingStartWorkdayId";
const DEVICE_ID_KEY = "deviceId";

export interface WorkdayControllerDeps {
  db: DriverDB;
  api: Pick<ApiClient, "startWorkday" | "endWorkday" | "currentWorkday">;
  device: DeviceServices;
  sender: BatchSender;
  config: Pick<AppConfig, "tracking" | "sync">;
  now?: () => number;
}

export class WorkdayController {
  private state: WorkdayState = { phase: "loading", workday: null, gps: "off", lastFixAt: null, error: null, conflict: null };
  private listeners = new Set<(s: WorkdayState) => void>();
  private stopWatch: (() => void) | null = null;
  private lastRecorded: PositionFix | null = null;
  private unsubscribers: Array<() => void> = [];
  private readonly now: () => number;

  constructor(private readonly deps: WorkdayControllerDeps) {
    this.now = deps.now ?? Date.now;
  }

  getState(): WorkdayState {
    return this.state;
  }

  subscribe(listener: (s: WorkdayState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Ciclo de vida de la app ----------------------------------------------------------------

  /**
   * Al abrir la app (con sesión): recupera la jornada local y reanuda lo pendiente.
   * Iniciar/finalizar esperan a que esto termine (`ready`), para que un toque apurado del
   * repartidor no compita con la lectura de la jornada guardada.
   */
  resume(): Promise<void> {
    this.ready = this.doResume();
    return this.ready;
  }

  private ready: Promise<void> | null = null;

  private async doResume(): Promise<void> {
    const { device, sender } = this.deps;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [
      device.lifecycle.subscribe((visible) => void this.onVisibility(visible)),
      device.network.subscribe((online) => {
        if (online) void this.retryPending();
      }),
    ];
    const workday = await activeWorkday(this.deps.db);
    this.set({ workday: workday ?? null, phase: workday ? (workday.status === "ENDING" ? "ending" : "active") : "idle" });
    await sender.refreshPending();
    if (workday?.status === "ACTIVE") this.startWatching();
    await this.retryPending();
  }

  private async whenReady(): Promise<void> {
    try {
      await this.ready;
    } catch {
      // un fallo al reanudar (por ejemplo, sin red) no impide operar
    }
  }

  /** Deja de escuchar al dispositivo. Los suscriptores de la UI se mantienen (React los maneja). */
  dispose(): void {
    this.stopWatching("off");
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  // --- Iniciar jornada ------------------------------------------------------------------------

  /**
   * Iniciar jornada. Hay que llamarlo directamente desde el toque del botón: la ubicación se
   * pide acá, ANTES de cualquier `await`. iOS solo muestra el pedido de permiso si la llamada
   * sale del gesto del usuario; leer IndexedDB o esperar a `resume()` antes ya lo pierde.
   */
  start(): Promise<void> {
    if (this.state.phase !== "idle" && this.state.phase !== "loading") return Promise.resolve();
    // Sin ubicación no se puede iniciar (§8.3): es la ubicación garantizada del evento.
    const location = this.deps.device.location.current().then(
      (fix) => ({ ok: true as const, fix }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    return this.doStart(location);
  }

  private async doStart(location: Promise<{ ok: true; fix: PositionFix } | { ok: false; error: unknown }>): Promise<void> {
    const { db, api, device } = this.deps;
    await this.whenReady();
    if (this.state.phase !== "idle") return;
    this.set({ phase: "starting", error: null, conflict: null });

    const result = await location;
    if (!result.ok) {
      const denied = result.error instanceof LocationError && result.error.code === "permission_denied";
      // No se inicia nada: ni jornada en el servidor ni registro local.
      this.set({
        phase: "idle",
        gps: denied ? "denied" : "error",
        error: denied
          ? "No se puede iniciar la jornada sin ubicación: el permiso está bloqueado."
          : "No se pudo obtener la ubicación y la jornada no se inició. Revisá que la ubicación del teléfono esté activada y probá de nuevo al aire libre.",
      });
      return;
    }
    const fix = result.fix;
    if (this.state.gps === "denied" || this.state.gps === "error") this.set({ gps: "off" }); // ya hay ubicación

    // El mismo id en cada reintento: el servidor no crea dos jornadas.
    let workdayId = await getMeta<string>(db, PENDING_START_KEY);
    if (!workdayId) {
      workdayId = uuidv7(this.now());
      await setMeta(db, PENDING_START_KEY, workdayId);
    }
    const now = this.now();
    const fixIsFresh = now - fix.timestamp <= this.deps.config.tracking.maxEventFixAgeMs && fix.timestamp <= now;
    // El inicio no puede ser posterior a la ubicación del evento: si no, el servidor la rechazaría.
    const startedAt = new Date(fixIsFresh ? fix.timestamp : now).toISOString();

    try {
      const info = device.info();
      const response = await api.startWorkday({
        workday_id: workdayId,
        started_at: startedAt,
        device: {
          id: await this.deviceId(),
          runtime: info.runtime,
          model: info.model,
          os_version: info.os_version,
          app_version: info.app_version,
          location_permission: await device.location.permission(),
        },
        location: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy },
      });
      const workday: LocalWorkday = {
        id: response.workday.id,
        status: "ACTIVE",
        started_at: response.workday.started_at,
        tracking_mode: response.workday.tracking_mode,
        tracking_token: response.tracking_token,
        tracking_token_expires_at: response.tracking_token_expires_at,
      };
      await db.transaction("rw", db.workdays, db.meta, async () => {
        await db.workdays.put(workday);
        await db.meta.delete(PENDING_START_KEY);
      });
      this.set({ phase: "active", workday });
      if (fixIsFresh) await this.saveFix(fix, "EVENT", "workday_start");
      void device.storage.persist();
      this.startWatching();
    } catch (error) {
      if (error instanceof ApiError && error.code === "workday_already_active") {
        await db.meta.delete(PENDING_START_KEY);
        const conflict = (error.body as { workday?: Workday }).workday ?? null;
        this.set({ phase: "idle", conflict, error: "Ya tenés una jornada iniciada en el servidor." });
        return;
      }
      this.set({ phase: "idle", error: describe(error, "No se pudo iniciar la jornada.") });
    }
  }

  /** Cierra en el servidor una jornada activa que este teléfono no tiene (por ejemplo, otro teléfono). */
  async closeServerConflict(): Promise<void> {
    const conflict = this.state.conflict;
    if (!conflict) return;
    try {
      await this.deps.api.endWorkday(conflict.id, { ended_at: new Date(this.now()).toISOString(), location: null });
      this.set({ conflict: null, error: null });
    } catch (error) {
      this.set({ error: describe(error, "No se pudo cerrar la jornada anterior.") });
    }
  }

  // --- Finalizar jornada ----------------------------------------------------------------------

  async end(): Promise<void> {
    const { db, device } = this.deps;
    await this.whenReady();
    const workday = this.state.workday;
    if (!workday || this.state.phase !== "active") return;
    this.set({ phase: "ending", error: null });

    let fix: PositionFix | null = null;
    try {
      fix = await device.location.current({ timeoutMs: 10_000 });
    } catch {
      fix = null; // finalizar no puede depender de tener ubicación
    }
    this.stopWatching("off");
    const now = this.now();
    const fresh = fix && now - fix.timestamp <= this.deps.config.tracking.maxEventFixAgeMs ? fix : null;
    // El fin nunca es anterior a la ubicación del evento de fin.
    const endedAt = new Date(Math.max(now, fresh?.timestamp ?? 0)).toISOString();
    if (fresh) await this.saveFix(fresh, "EVENT", "workday_end");

    const ending: LocalWorkday = {
      ...workday,
      status: "ENDING",
      end: {
        ended_at: endedAt,
        location: fresh ? { lat: fresh.lat, lng: fresh.lng, accuracy: fresh.accuracy } : null,
        sent: false,
      },
    };
    await db.workdays.put(ending);
    this.set({ workday: ending });
    await this.retryPending();
  }

  // --- Reintentos -----------------------------------------------------------------------------

  /** Manda lo pendiente: puntos y, si corresponde, el fin de jornada. */
  async retryPending(): Promise<void> {
    const { db, api, sender } = this.deps;
    await sender.flush();
    await this.cleanupFinished();
    const workday = await activeWorkday(db);
    if (!workday?.end || workday.end.sent) return;
    try {
      await api.endWorkday(workday.id, { ended_at: workday.end.ended_at, location: workday.end.location });
    } catch (error) {
      if (error instanceof NetworkError) {
        this.set({ error: "Sin conexión: el fin de la jornada se va a enviar cuando vuelva la señal." });
        return;
      }
      this.set({ error: describe(error, "No se pudo finalizar la jornada en el servidor.") });
      return;
    }
    // Finalizada en el servidor. Si no quedan puntos, se borra todo lo de esa jornada del teléfono.
    await db.workdays.update(workday.id, { status: "FINISHED", end: { ...workday.end, sent: true } });
    await this.cleanupFinished();
    this.set({ phase: "idle", workday: null, error: null, gps: "off" });
  }

  /** Datos en el teléfono: solo los de la jornada actual (§11). */
  async cleanupFinished(): Promise<void> {
    const { db } = this.deps;
    for (const w of await db.workdays.where("status").equals("FINISHED").toArray()) {
      const pending = await db.points.where("workday_id").equals(w.id).count();
      if (pending === 0) await db.workdays.delete(w.id);
    }
  }

  // --- Seguimiento con la app abierta --------------------------------------------------------

  private startWatching(): void {
    const { device } = this.deps;
    if (this.stopWatch || !device.lifecycle.visible()) {
      if (!device.lifecycle.visible()) this.set({ gps: "paused" });
      return;
    }
    this.stopWatch = device.location.watch(
      (fix) => void this.onFix(fix),
      (error) => {
        // Sin permiso el navegador no vuelve a intentar: se suelta el seguimiento para
        // retomarlo cuando la app vuelve a primer plano (por ejemplo, después de ir a Ajustes).
        if (error.code === "permission_denied") this.stopWatching("denied");
        else this.set({ gps: "error" });
      },
    );
    this.set({ gps: "watching" });
  }

  private stopWatching(gps: GpsState): void {
    this.stopWatch?.();
    this.stopWatch = null;
    this.set({ gps });
  }

  /**
   * Al volver de Ajustes: si el permiso ya no figura como bloqueado, se saca el aviso para que
   * el repartidor pueda volver a tocar "Iniciar jornada" (que es lo que dispara el pedido).
   */
  async recheckPermission(): Promise<void> {
    if (this.state.phase !== "idle" || this.state.gps !== "denied") return;
    const permission = await this.deps.device.location.permission();
    if (permission !== "denied" && this.state.phase === "idle" && this.state.gps === "denied") {
      this.set({ gps: "off", error: null });
    }
  }

  private async onVisibility(visible: boolean): Promise<void> {
    if (visible && this.state.phase === "idle") return this.recheckPermission();
    if (this.state.phase !== "active") return;
    if (visible) {
      this.startWatching();
      await this.retryPending();
    } else {
      // El navegador no da ubicación en segundo plano: se corta acá y el hueco queda marcado.
      this.stopWatching("paused");
      void this.deps.sender.flush();
    }
  }

  private async onFix(fix: PositionFix): Promise<void> {
    if (this.state.phase !== "active") return;
    this.set({ gps: "watching", lastFixAt: fix.timestamp });
    if (!shouldRecord(this.lastRecorded, fix, this.deps.config.tracking)) return;
    await this.saveFix(fix, "FOREGROUND");
  }

  private async saveFix(fix: PositionFix, source: "FOREGROUND" | "EVENT", event?: string): Promise<void> {
    const { db, device, sender, config } = this.deps;
    const workday = this.state.workday;
    if (!workday) return;
    const point = buildPoint(fix, { source, event, battery: await device.battery.level(), rules: config.tracking, now: this.now() });
    const outcome = await recordPoint(db, { ...workday, ended_at: workday.end?.ended_at ?? null }, point, this.now());
    if (!outcome.saved) return;
    this.lastRecorded = fix;
    this.set({ lastFixAt: fix.timestamp });
    await sender.refreshPending();
    sender.flushSoon(source === "EVENT" ? 0 : config.sync.debounceMs);
  }

  private async deviceId(): Promise<string> {
    let id = await getMeta<string>(this.deps.db, DEVICE_ID_KEY);
    if (!id) {
      id = uuidv7(this.now());
      await setMeta(this.deps.db, DEVICE_ID_KEY, id);
    }
    return id;
  }

  private set(patch: Partial<WorkdayState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof NetworkError) return "Sin conexión con el servidor. Probá de nuevo cuando tengas señal.";
  if (error instanceof ApiError) return error.message || fallback;
  return fallback;
}
