/** Arma las piezas de la app. Las pruebas arman las mismas piezas con dobles de prueba. */
import { ApiClient } from "./api/client";
import { SessionStore } from "./auth/session";
import { type AppConfig, config as defaultConfig } from "./config";
import type { DeviceServices } from "./device/DeviceServices";
import { createWebDeviceServices } from "./device/web";
import { DriverDB } from "./store/db";
import { BatchSender } from "./sync/batchSender";
import { UpdateManager } from "./pwaUpdate";
import { Deliveries } from "./delivery/deliveries";
import { Outbox } from "./delivery/outbox";
import { WorkdayController } from "./tracking/workdayController";

export interface AppServices {
  config: AppConfig;
  db: DriverDB;
  api: ApiClient;
  device: DeviceServices;
  sender: BatchSender;
  session: SessionStore;
  workday: WorkdayController;
  /** Lo hecho en la calle (visitas, fotos, comunicaciones), esperando ser enviado (ADR-013). */
  outbox: Outbox;
  /** "Mis paquetes" y la visita en curso. */
  deliveries: Deliveries;
  /** Estado de la interfaz que dura lo que dura esta apertura de la app (no se guarda). */
  ui: { splashShown: boolean };
  /** Versiones nuevas de la PWA: solas sin jornada en curso, con aviso durante la jornada. */
  updates: UpdateManager;
  /** Arranca lo que depende de tener sesión (jornada, envíos periódicos). */
  startAuthenticated(): Promise<void>;
  stopAuthenticated(): void;
}

export function createApp(overrides: Partial<Pick<AppServices, "db" | "api" | "device" | "config">> = {}): AppServices {
  const config = overrides.config ?? defaultConfig;
  const db = overrides.db ?? new DriverDB();
  const api = overrides.api ?? new ApiClient(config.apiBase);
  const device = overrides.device ?? createWebDeviceServices();
  const sender = new BatchSender({ db, api, batchSize: config.sync.batchSize, isOnline: () => device.network.online() });
  const session = new SessionStore(api);
  const workday = new WorkdayController({ db, api, device, sender, config });
  const outbox = new Outbox(db, api);
  const deliveries = new Deliveries({ db, api, outbox, device, workday });
  let interval: ReturnType<typeof setInterval> | null = null;
  // Con la jornada iniciándose, en curso o finalizándose, una recarga cortaría el seguimiento.
  const updates = new UpdateManager(() => !["starting", "active", "ending"].includes(workday.getState().phase));
  workday.subscribe(() => updates.maybeUpdate());

  return {
    config,
    db,
    api,
    device,
    sender,
    session,
    workday,
    outbox,
    deliveries,
    ui: { splashShown: false },
    updates,
    async startAuthenticated() {
      await workday.resume();
      void deliveries.load();
      void outbox.refresh().then(() => outbox.flush());
      // Envío periódico mientras la app está abierta (§5.2).
      interval ??= setInterval(() => {
        if (!device.lifecycle.visible()) return;
        void workday.retryPending();
        void outbox.flush();
      }, config.sync.periodicFlushMs);
    },
    stopAuthenticated() {
      if (interval) clearInterval(interval);
      interval = null;
      workday.dispose();
      outbox.dispose();
    },
  };
}
