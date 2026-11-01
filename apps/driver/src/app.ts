/** Arma las piezas de la app. Las pruebas arman las mismas piezas con dobles de prueba. */
import { ApiClient } from "./api/client";
import { SessionStore } from "./auth/session";
import { type AppConfig, config as defaultConfig } from "./config";
import type { DeviceServices } from "./device/DeviceServices";
import { createWebDeviceServices } from "./device/web";
import { DriverDB } from "./store/db";
import { BatchSender } from "./sync/batchSender";
import { WorkdayController } from "./tracking/workdayController";

export interface AppServices {
  config: AppConfig;
  db: DriverDB;
  api: ApiClient;
  device: DeviceServices;
  sender: BatchSender;
  session: SessionStore;
  workday: WorkdayController;
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
  let interval: ReturnType<typeof setInterval> | null = null;

  return {
    config,
    db,
    api,
    device,
    sender,
    session,
    workday,
    async startAuthenticated() {
      await workday.resume();
      // Envío periódico mientras la app está abierta (§5.2).
      interval ??= setInterval(() => {
        if (device.lifecycle.visible()) void workday.retryPending();
      }, config.sync.periodicFlushMs);
    },
    stopAuthenticated() {
      if (interval) clearInterval(interval);
      interval = null;
      workday.dispose();
    },
  };
}
