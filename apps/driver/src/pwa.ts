import { registerSW } from "virtual:pwa-register";

import type { UpdateManager } from "./pwaUpdate";

/** Cada cuánto se busca una versión nueva con la app abierta (además de al abrirla). */
const CHECK_EVERY_MS = 30 * 60_000;

/**
 * Registra el Service Worker. Cuándo se instala una versión nueva lo decide `UpdateManager`
 * (sola sin jornada en curso; con aviso durante la jornada).
 */
export function registerServiceWorker(updates: UpdateManager): void {
  if (!("serviceWorker" in navigator)) return;
  const updateSW = registerSW({
    onNeedRefresh() {
      updates.onNeedRefresh(() => updateSW(true));
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // iOS revisa poco: también al volver a la app y cada tanto con la app abierta.
      const check = () => void registration.update().catch(() => {});
      setInterval(check, CHECK_EVERY_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });
}
