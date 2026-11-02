/** Sesión del panel. El access token lo guarda ApiClient en memoria; el refresh es una cookie httpOnly. */
import { ApiError, type ApiClient, type LoginResult } from "@routcontrol/api-client";
import type { Session } from "@routcontrol/domain";

export type SessionInfo = Omit<Session, "access">;

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous"; error?: string }
  | { status: "choose_organization"; email: string; options: Extract<LoginResult, { kind: "choose" }>["options"] }
  | { status: "authenticated"; session: SessionInfo };

/** §8: el panel es para dueño, administrador y supervisor. */
export const STAFF_ROLES = ["OWNER", "ADMIN", "SUPERVISOR"] as const;
export const NOT_STAFF = "El panel es para dueños, administradores y supervisores. Los repartidores usan la app del teléfono.";

export const ROLE_LABEL: Record<Session["role"], string> = {
  OWNER: "Dueño/a",
  ADMIN: "Administración",
  SUPERVISOR: "Supervisión",
  DRIVER: "Repartidor/a",
};

export class AdminSession {
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

  async restore(): Promise<void> {
    try {
      if (await this.api.refresh()) return this.accept(await this.api.me());
    } catch {
      // sin red o sin sesión: se muestra el login
    }
    this.set({ status: "anonymous" });
  }

  async login(email: string, password: string, organizationId?: string): Promise<void> {
    try {
      const result = await this.api.login(email.trim().toLowerCase(), password, organizationId);
      if (result.kind === "choose") {
        this.pendingPassword = password;
        return this.set({ status: "choose_organization", email, options: result.options });
      }
      this.pendingPassword = null;
      const { access: _access, ...info } = result.session;
      this.accept(info);
    } catch (error) {
      this.set({ status: "anonymous", error: error instanceof ApiError ? error.message : "Sin conexión con el servidor." });
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
    if (!(STAFF_ROLES as readonly string[]).includes(info.role)) {
      this.api.clearSession();
      return this.set({ status: "anonymous", error: NOT_STAFF });
    }
    this.set({ status: "authenticated", session: info });
  }

  private set(state: SessionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
