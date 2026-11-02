import type { ApiClient } from "@routcontrol/api-client";
import type { AppNotification } from "@routcontrol/domain";

/**
 * Alertas del panel (ADR-025): cuántas son nuevas y la última que llegó en vivo (para el aviso
 * flotante). Se actualiza consultando cada 30 s (Layout) y, en el inicio, al instante por el
 * WebSocket del mapa en vivo (una sola conexión).
 */
export interface AlertsState {
  unread: number;
  toast: AppNotification | null;
}

export class AlertsStore {
  private state: AlertsState = { unread: 0, toast: null };
  private listeners = new Set<(s: AlertsState) => void>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly api: Pick<ApiClient, "listNotifications" | "markNotificationsSeen">) {}

  getState(): AlertsState {
    return this.state;
  }

  subscribe(listener: (s: AlertsState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<AlertsState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  async refresh(): Promise<void> {
    try {
      const r = await this.api.listNotifications();
      this.set({ unread: r.unread });
    } catch {
      // Un corte momentáneo no borra el contador; la próxima consulta lo corrige.
    }
  }

  /** Llegó en vivo: suma al contador y se muestra unos segundos. */
  push(n: AppNotification, toastMs = 7000): void {
    this.set({ unread: this.state.unread + 1, toast: n });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.set({ toast: null }), toastMs);
  }

  dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.set({ toast: null });
  }

  async markSeen(): Promise<void> {
    await this.api.markNotificationsSeen();
    this.set({ unread: 0 });
  }
}
