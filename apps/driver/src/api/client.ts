/**
 * Cliente de la API.
 *
 * - El access token vive SOLO en memoria (esta clase). Nunca va a localStorage ni a IndexedDB.
 * - El refresh token es una cookie httpOnly: el JavaScript no la ve; alcanza con
 *   `credentials: "include"` (mismo origen con el proxy de Vite; api.<dominio> en producción).
 * - Ante un 401 se intenta un refresh una sola vez y se repite la petición.
 */
import {
  type ChooseOrganization,
  chooseOrganization,
  type Session,
  session as sessionSchema,
  type StartWorkdayResponse,
  startWorkdayResponse,
  type TrackingBatchRequest,
  type TrackingBatchResponse,
  trackingBatchResponse,
  type Workday,
  workdayEnvelope,
  workdayList,
  type WorkdayTrack,
  workdayTrack,
  type WorkdayWithDriver,
} from "@routcontrol/domain";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(ApiError.describe(status, body));
    this.name = "ApiError";
  }

  get code(): string | undefined {
    return typeof this.body === "object" && this.body !== null && "code" in this.body
      ? String((this.body as { code: unknown }).code)
      : undefined;
  }

  static describe(status: number, body: unknown): string {
    if (typeof body === "object" && body !== null && "detail" in body) return String((body as { detail: unknown }).detail);
    return `Error ${status}`;
  }
}

/** No hubo respuesta del servidor (sin señal, servidor caído, CORS...). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Sin conexión con el servidor");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

export type LoginResult = { kind: "ok"; session: Session } | { kind: "choose"; options: ChooseOrganization["organizations"] };

export interface StartWorkdayBody {
  workday_id: string;
  started_at: string;
  device: {
    id: string;
    runtime: "PWA" | "NATIVE_ANDROID" | "NATIVE_IOS";
    model: string;
    os_version: string;
    app_version: string;
    location_permission: string;
  };
  location: { lat: number; lng: number; accuracy: number } | null;
}

type Fetch = typeof fetch;

export class ApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly base: string,
    private readonly fetchImpl: Fetch = (...args) => globalThis.fetch(...args),
  ) {}

  get hasAccessToken(): boolean {
    return this.accessToken !== null;
  }

  clearSession(): void {
    this.accessToken = null;
  }

  // --- Sesión ---------------------------------------------------------------------------------

  async login(email: string, password: string, organizationId?: string): Promise<LoginResult> {
    const response = await this.raw("/auth/login", {
      method: "POST",
      body: { email, password, ...(organizationId ? { organization_id: organizationId } : {}) },
    });
    const body = await readJson(response);
    if (response.status === 409) {
      const parsed = chooseOrganization.safeParse(body);
      if (parsed.success) return { kind: "choose", options: parsed.data.organizations };
    }
    if (!response.ok) throw new ApiError(response.status, body);
    const session = sessionSchema.parse(body);
    this.accessToken = session.access;
    return { kind: "ok", session };
  }

  /** Renueva el access token con la cookie. Devuelve false si no hay sesión. */
  refresh(): Promise<boolean> {
    // Varias peticiones con 401 a la vez comparten un solo refresh (el refresh es rotativo).
    this.refreshing ??= (async () => {
      try {
        const response = await this.raw("/auth/refresh", { method: "POST" });
        if (!response.ok) {
          this.accessToken = null;
          return false;
        }
        const body = (await readJson(response)) as { access?: unknown };
        this.accessToken = typeof body.access === "string" ? body.access : null;
        return this.accessToken !== null;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async logout(): Promise<void> {
    try {
      await this.raw("/auth/logout", { method: "POST" });
    } finally {
      this.accessToken = null;
    }
  }

  async me(): Promise<Omit<Session, "access">> {
    return this.authed("/auth/me", { method: "GET" }, sessionSchema.omit({ access: true }));
  }

  // --- Jornada --------------------------------------------------------------------------------

  startWorkday(body: StartWorkdayBody): Promise<StartWorkdayResponse> {
    return this.authed("/workdays/start", { method: "POST", body }, startWorkdayResponse);
  }

  async endWorkday(
    workdayId: string,
    body: { ended_at: string; location: { lat: number; lng: number; accuracy: number } | null },
  ): Promise<Workday> {
    const result = await this.authed(`/workdays/${workdayId}/end`, { method: "POST", body }, workdayEnvelope);
    return result.workday!;
  }

  async currentWorkday(): Promise<Workday | null> {
    return (await this.authed("/workdays/current", { method: "GET" }, workdayEnvelope)).workday;
  }

  // --- Recorridos (mapa) ----------------------------------------------------------------------

  async listWorkdays(date?: string): Promise<WorkdayWithDriver[]> {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    return (await this.authed(`/workdays/${query}`, { method: "GET" }, workdayList)).workdays;
  }

  workdayTrack(workdayId: string): Promise<WorkdayTrack> {
    return this.authed(`/workdays/${workdayId}/track`, { method: "GET" }, workdayTrack);
  }

  // --- Tracking (con el token de la jornada, no con la sesión) -------------------------------

  async postBatch(trackingToken: string, body: TrackingBatchRequest): Promise<TrackingBatchResponse> {
    const response = await this.raw("/tracking/batch", {
      method: "POST",
      body,
      headers: { Authorization: `Tracking ${trackingToken}` },
    });
    const json = await readJson(response);
    if (!response.ok) throw new ApiError(response.status, json);
    return trackingBatchResponse.parse(json);
  }

  // --- Interno --------------------------------------------------------------------------------

  private async authed<T>(path: string, init: RequestInit_, schema: z.ZodType<T>): Promise<T> {
    if (!this.accessToken) await this.refresh();
    let response = await this.raw(path, init, this.accessToken);
    if (response.status === 401 && (await this.refresh())) {
      response = await this.raw(path, init, this.accessToken);
    }
    const body = await readJson(response);
    if (!response.ok) throw new ApiError(response.status, body);
    return schema.parse(body);
  }

  private async raw(path: string, init: RequestInit_, bearer?: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json", ...init.headers };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    try {
      return await this.fetchImpl(`${this.base}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: "include",
      });
    } catch (error) {
      throw new NetworkError(error);
    }
  }
}

interface RequestInit_ {
  method: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text.slice(0, 200) };
  }
}
