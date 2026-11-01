import { ApiClient } from "../api/client";
import { config } from "../config";
import { DriverDB } from "../store/db";
import { BatchSender } from "../sync/batchSender";
import { WorkdayController } from "../tracking/workdayController";
import { FakeBackend } from "./fakeBackend";
import { FakeDevice } from "./fakeDevice";

export function freshDb(): DriverDB {
  return new DriverDB(`test-${crypto.randomUUID()}`);
}

/** Todas las piezas reales (cliente, cola, jornada) contra el backend y el dispositivo falsos. */
export async function setup(opts: { loggedIn?: boolean } = {}) {
  const backend = new FakeBackend();
  const device = new FakeDevice();
  const db = freshDb();
  const api = new ApiClient("/api/v1", backend.fetch);
  const timers = manualTimers();
  const sender = new BatchSender({ db, api, batchSize: 3, timers, isOnline: () => device.isOnline, random: () => 0.5 });
  const workday = new WorkdayController({ db, api, device, sender, config });
  if (opts.loggedIn !== false) await api.login("repartidor@demo.test", "secreta");
  return { backend, device, db, api, sender, workday, timers };
}

/** Temporizadores manuales: las pruebas deciden cuándo "pasa el tiempo". */
export function manualTimers() {
  let seq = 0;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    pending,
    setTimeout(fn: () => void, ms: number) {
      const id = ++seq;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout(handle: unknown) {
      pending.delete(handle as number);
    },
    /** Ejecuta todos los temporizadores pendientes (una ronda). */
    runAll() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, t] of due) t.fn();
    },
    delays() {
      return [...pending.values()].map((t) => t.ms);
    },
  };
}

/** Espera a que terminen las promesas encadenadas (IndexedDB falso + fetch falso). */
export async function settle(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}
