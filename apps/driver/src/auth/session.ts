/** Estado de la sesión. El access token lo guarda ApiClient en memoria; acá solo los datos visibles. */
import type { Session } from "@routcontrol/domain";

import { ApiError, type ApiClient, type LoginResult } from "../api/client";

export type SessionInfo = Omit<Session, "access">;

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous"; error?: string }
  | { status: "choose_organization"; email: string; options: Extract<LoginResult, { kind: "choose" }>["options"] }
  | { status: "authenticated"; session: SessionInfo };

export const NOT_A_DRIVER = "Esta app es para repartidores. Para administrar, usá el panel.";

export class SessionStore {
  private state: SessionState = { status: "loading" };
  private listeners = new Set<(s: SessionState) => void>();
  private pendingPassword: string | null = null;

  constructor(private readonly api: Pick<ApiClient, "login" | "refresh" | "logout" | "me" | "clearSession">) {}

  getState(): SessionState {
    return this.state;
  }

  subscribe(listener: (s: SessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Al abrir la app: si la cookie de refresh sigue vigente, se recupera la sesión sin pedir login. */
  async restore(): Promise<void> {
    try {
      if (await this.api.refresh()) {
        const me = await this.api.me();
        return this.accept(me);
      }
    } catch {
      // Sin red: se muestra el login; los datos locales (puntos pendientes) siguen guardados.
    }
    this.set({ status: "anonymous" });
  }

  async login(email: string, password: string, organizationId?: string): Promise<void> {
    try {
      const result = await this.api.login(email, password, organizationId);
      if (result.kind === "choose") {
        this.pendingPassword = password;
        return this.set({ status: "choose_organization", email, options: result.options });
      }
      this.pendingPassword = null;
      const { access: _access, ...info } = result.session;
      this.accept(info);
    } catch (error) {
      this.set({
        status: "anonymous",
        error: error instanceof ApiError ? error.message : "Sin conexión con el servidor.",
      });
    }
  }

  async chooseOrganization(organizationId: string): Promise<void> {
    const state = this.state;
    if (state.status !== "choose_organization" || this.pendingPassword === null) return;
    await this.login(state.email, this.pendingPassword, organizationId);
  }

  async logout(): Promise<void> {
    try {
      await this.api.logout();
    } finally {
      this.set({ status: "anonymous" });
    }
  }

  private accept(info: SessionInfo): void {
    if (info.role !== "DRIVER") {
      this.api.clearSession();
      return this.set({ status: "anonymous", error: NOT_A_DRIVER });
    }
    this.set({ status: "authenticated", session: info });
  }

  private set(state: SessionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
