import { formatAgo, StatusLine, type StatusTone } from "@routcontrol/ui";

import type { SyncStatus } from "../sync/batchSender";

/** Indicador de sincronización (§5.2), siempre visible. */
export function describeSync(status: SyncStatus, now: number): { tone: StatusTone; title: string; detail: string } {
  const pending = status.pending === 1 ? "1 punto pendiente" : `${status.pending} puntos pendientes`;
  switch (status.kind) {
    case "synced":
      return { tone: "ok", title: "Conectado y actualizado", detail: `Última sincronización ${formatAgo(status.lastSyncAt, now)}` };
    case "syncing":
      return { tone: "busy", title: "Sincronizando…", detail: pending };
    case "offline":
      return { tone: "warn", title: "Sin conexión, cambios guardados", detail: `${pending} en el teléfono. Se envían solos al volver la señal.` };
    case "error":
      return { tone: "error", title: "Error de sincronización", detail: status.message };
    case "idle":
      return status.pending === 0
        ? { tone: "ok", title: "Conectado y actualizado", detail: `Última sincronización ${formatAgo(status.lastSyncAt, now)}` }
        : { tone: "busy", title: "Pendiente de envío", detail: pending };
  }
}

export function SyncIndicator({ status, now }: { status: SyncStatus; now: number }) {
  const d = describeSync(status, now);
  return <StatusLine tone={d.tone} title={d.title} detail={d.detail} live testId="sync-indicator" />;
}
