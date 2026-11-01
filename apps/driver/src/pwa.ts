import { registerSW } from "virtual:pwa-register";

/**
 * Registra el Service Worker. Con una versión nueva no se recarga sola: si el repartidor está en
 * plena jornada, una recarga inesperada cortaría el seguimiento. Se actualiza cuando él acepta.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  const updateSW = registerSW({
    onNeedRefresh() {
      if (window.confirm("Hay una versión nueva de la app. ¿Actualizar ahora?")) void updateSW(true);
    },
  });
}
