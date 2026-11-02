import { ApiClient } from "@routcontrol/api-client";
import { ApiError, NetworkError } from "@routcontrol/api-client";
import { createContext, useContext, useSyncExternalStore } from "react";

import { AlertsStore } from "./alerts";
import { type AdminConfig, config as defaultConfig } from "./config";
import { AdminSession } from "./session";

export interface AdminApp {
  config: AdminConfig;
  api: ApiClient;
  session: AdminSession;
  /** Estado de la interfaz que dura lo que dura esta apertura del panel (no se guarda). */
  ui: { splashShown: boolean };
  /** Mapa en vivo (ADR-017). `WebSocketImpl: null` lo apaga (pruebas que no lo usan). */
  live: { WebSocketImpl: typeof WebSocket | null; retryDelayMs?: (attempt: number) => number };
  /** Alertas del panel (ADR-025). */
  alerts: AlertsStore;
}

export function createAdminApp(overrides: Partial<Pick<AdminApp, "api" | "config" | "live">> = {}): AdminApp {
  const config = overrides.config ?? defaultConfig;
  const api = overrides.api ?? new ApiClient(config.apiBase);
  const live = overrides.live ?? { WebSocketImpl: globalThis.WebSocket ?? null };
  return { config, api, session: new AdminSession(api), ui: { splashShown: false }, live, alerts: new AlertsStore(api) };
}

export const AdminContext = createContext<AdminApp | null>(null);

export function useAdmin(): AdminApp {
  const app = useContext(AdminContext);
  if (!app) throw new Error("Falta <AdminContext.Provider>");
  return app;
}

export function useSession() {
  const { session } = useAdmin();
  return useSyncExternalStore(
    (cb) => session.subscribe(() => cb()),
    () => session.getState(),
    () => session.getState(),
  );
}

/** Mensaje de error de carga, en español y con la causa. */
export function describeLoadError(error: unknown, what: string): string {
  if (error instanceof NetworkError) return `Sin conexión con el servidor: no se pudo cargar ${what}.`;
  if (error instanceof ApiError) {
    if (error.status === 404) return `No se encontró ${what}.`;
    if (error.status === 401) return "Tu sesión venció. Volvé a ingresar.";
    if (error.status === 403) return `Tu rol no permite ver ${what}.`;
    return `No se pudo cargar ${what} (error ${error.status}).`;
  }
  return `No se pudo cargar ${what}.`;
}

/** Mensaje de error de una acción (crear, asignar…): el motivo que da el servidor. */
export function actionError(error: unknown): string {
  if (error instanceof NetworkError) return "Sin conexión con el servidor. Probá de nuevo.";
  if (error instanceof ApiError) return error.message || `Error ${error.status}.`;
  return "No se pudo completar la acción.";
}
