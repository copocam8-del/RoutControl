import type { SyncStatus } from "../sync/batchSender";
import { ago } from "./format";

/** Indicador de sincronización (§5.2), siempre visible. */
export function describeSync(status: SyncStatus, now: number): { tone: "ok" | "warn" | "busy" | "error"; title: string; detail: string } {
  const pending = status.pending === 1 ? "1 punto pendiente" : `${status.pending} puntos pendientes`;
  switch (status.kind) {
    case "synced":
      return { tone: "ok", title: "Conectado y actualizado", detail: `Última sincronización ${ago(status.lastSyncAt, now)}` };
    case "syncing":
      return { tone: "busy", title: "Sincronizando…", detail: pending };
    case "offline":
      return { tone: "warn", title: "Sin conexión, cambios guardados", detail: `${pending} en el teléfono` };
    case "error":
      return { tone: "error", title: "Error de sincronización", detail: status.message };
    case "idle":
      return status.pending === 0
        ? { tone: "ok", title: "Conectado y actualizado", detail: `Última sincronización ${ago(status.lastSyncAt, now)}` }
        : { tone: "busy", title: "Pendiente de envío", detail: pending };
  }
}

export function SyncIndicator({ status, now }: { status: SyncStatus; now: number }) {
  const d = describeSync(status, now);
  return (
    <div className={`status status--${d.tone}`} role="status" aria-live="polite" data-testid="sync-indicator">
      <span className="status__dot" aria-hidden="true" />
      <div>
        <div className="status__title">{d.title}</div>
        <div className="status__detail">{d.detail}</div>
      </div>
    </div>
  );
}
