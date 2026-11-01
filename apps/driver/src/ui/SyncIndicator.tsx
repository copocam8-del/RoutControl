import { Chip, type ChipTone, formatAgo, IconSync } from "@routcontrol/ui";

import type { SyncStatus } from "../sync/batchSender";

export interface SyncDescription {
  tone: ChipTone;
  title: string;
  /** Texto corto para la pastilla. */
  short: string;
  detail: string;
}

/** Estado de sincronización (§5.2), siempre visible. */
export function describeSync(status: SyncStatus, now: number): SyncDescription {
  const pending = status.pending === 1 ? "1 ubicación pendiente" : `${status.pending} ubicaciones pendientes`;
  const synced = (): SyncDescription => ({
    tone: "ok",
    title: "Conectado y actualizado",
    short: "Conectado y al día",
    detail: `Última sincronización ${formatAgo(status.lastSyncAt, now)}`,
  });
  switch (status.kind) {
    case "synced":
      return synced();
    case "syncing":
      return { tone: "busy", title: "Sincronizando…", short: "Sincronizando…", detail: pending };
    case "offline":
      return {
        tone: "warn",
        title: "Sin conexión, cambios guardados",
        short: "Sin conexión · guardado",
        detail: `${pending} en el teléfono. Se envían solas al volver la señal.`,
      };
    case "error":
      return { tone: "error", title: "Error de sincronización", short: "Error de envío", detail: status.message };
    case "idle":
      return status.pending === 0
        ? synced()
        : { tone: "busy", title: "Pendiente de envío", short: `${status.pending} sin enviar`, detail: pending };
  }
}

/** Pastilla de sincronización. `compact`: "Al día" con el ícono (encabezado de la jornada). */
export function SyncChip({ status, now, compact = false }: { status: SyncStatus; now: number; compact?: boolean }) {
  const d = describeSync(status, now);
  const text = compact && d.tone === "ok" ? "Al día" : d.short;
  return (
    <span role="status" aria-live="polite" aria-label={`${d.title}. ${d.detail}`} data-testid="sync-indicator">
      <Chip tone={compact && d.tone === "ok" ? "neutral" : d.tone} dot={!compact} icon={compact ? <IconSync size={16} /> : undefined} title={d.detail}>
        {text}
      </Chip>
    </span>
  );
}
