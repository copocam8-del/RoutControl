/**
 * Almacenamiento local de la PWA: IndexedDB con Dexie (§5.3). En la fase 2, la app nativa usa
 * SQLite detrás de la misma forma de uso.
 *
 * Qué se guarda: solo lo de la jornada actual (y lo que quede pendiente de enviar de la
 * anterior). El access token NUNCA se guarda acá: vive en memoria (ADR-005).
 */
import type { LocationPoint } from "@routcontrol/domain";
import Dexie, { type Table } from "dexie";

/** Un punto GPS esperando ser enviado. */
export interface PendingPoint extends LocationPoint {
  workday_id: string;
  /** Momento en que se guardó en el teléfono (para ordenar el envío). */
  queued_at: number;
}

export type LocalWorkdayStatus = "ACTIVE" | "ENDING" | "FINISHED";

/**
 * Una jornada del teléfono. Guarda su TrackingToken porque los puntos pendientes se tienen que
 * poder enviar aunque se recargue la app o se pierda la sesión. Ese token solo sirve para subir
 * puntos de esa jornada (alcance limitado, ADR-003) y se borra junto con la jornada.
 */
export interface LocalWorkday {
  id: string;
  status: LocalWorkdayStatus;
  started_at: string;
  tracking_mode: "CONTINUOUS" | "EVENTS_ONLY";
  tracking_token: string;
  tracking_token_expires_at: string;
  /** El servidor dijo que el token ya no sirve (401): no se reintenta con él. */
  token_invalid?: boolean;
  /** El servidor no da un token nuevo (pasó la gracia, dispositivo dado de baja): los puntos no se
   * van a poder enviar. Se deja de intentar (ADR-010). */
  recovery_failed?: boolean;
  /** "Finalizar jornada" presionado; si todavía no llegó al servidor, se reintenta. */
  end?: { ended_at: string; location: { lat: number; lng: number; accuracy: number } | null; sent: boolean };
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface SyncLogRow {
  id?: number;
  at: number;
  kind: "batch_ok" | "batch_error" | "rejected" | "token_invalid";
  detail: string;
}

export class DriverDB extends Dexie {
  points!: Table<PendingPoint, string>;
  workdays!: Table<LocalWorkday, string>;
  meta!: Table<MetaRow, string>;
  log!: Table<SyncLogRow, number>;

  constructor(name = "routcontrol-driver") {
    super(name);
    this.version(1).stores({
      points: "point_id, workday_id, [workday_id+queued_at]",
      workdays: "id, status",
      meta: "key",
      log: "++id, at",
    });
  }
}

const LOG_LIMIT = 200;

export async function addLog(db: DriverDB, row: Omit<SyncLogRow, "id">): Promise<void> {
  await db.log.add(row);
  const count = await db.log.count();
  if (count > LOG_LIMIT) {
    const old = await db.log.orderBy("at").limit(count - LOG_LIMIT).primaryKeys();
    await db.log.bulkDelete(old);
  }
}

export async function getMeta<T>(db: DriverDB, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(db: DriverDB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function activeWorkday(db: DriverDB): Promise<LocalWorkday | undefined> {
  return (await db.workdays.where("status").anyOf("ACTIVE", "ENDING").toArray())[0];
}
