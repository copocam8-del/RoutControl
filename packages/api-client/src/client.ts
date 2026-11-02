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
  driverList,
  type DriverSummary,
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
  trackingTokenRecovery,
  bulkAssignResult,
  type DeliveryPackage,
  packageEnvelope,
  packageEvents,
  type PackageEvent,
  type PackageInput,
  packageList,
  type ColumnMapping,
  importEnvelope,
  type ImportJob,
  importPreview,
  type ImportPreview,
  packageVisits,
  visitCreated,
  type VisitOutcome,
  type VisitRecord,
  route,
  type Route,
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

  private readonly getRetryDelayMs: number;

  constructor(
    private readonly base: string,
    private readonly fetchImpl: Fetch = (...args) => globalThis.fetch(...args),
    options: { getRetryDelayMs?: number } = {},
  ) {
    this.getRetryDelayMs = options.getRetryDelayMs ?? 800;
  }

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

  /** Token nuevo para la jornada cuyo token quedó inválido, dentro de la gracia (ADR-010). */
  async recoverTrackingToken(workdayId: string): Promise<{ tracking_token: string; tracking_token_expires_at: string }> {
    return this.authed(`/workdays/${workdayId}/tracking-token`, { method: "POST", body: {} }, trackingTokenRecovery);
  }

  async currentWorkday(): Promise<Workday | null> {
    return (await this.authed("/workdays/current", { method: "GET" }, workdayEnvelope)).workday;
  }

  // --- Recorridos (mapa) ----------------------------------------------------------------------

  async listWorkdays(date?: string): Promise<WorkdayWithDriver[]> {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    return (await this.authed(`/workdays/${query}`, { method: "GET" }, workdayList)).workdays;
  }

  /** Solo dueño, admin y supervisor (panel). */
  async listDrivers(): Promise<DriverSummary[]> {
    return (await this.authed("/drivers/", { method: "GET" }, driverList)).drivers;
  }

  // --- Paquetes (etapa 1) ---------------------------------------------------------------------

  async listPackages(filters: { status?: string[]; driver?: string; q?: string } = {}): Promise<DeliveryPackage[]> {
    const params = new URLSearchParams();
    if (filters.status?.length) params.set("status", filters.status.join(","));
    if (filters.driver) params.set("driver", filters.driver);
    if (filters.q) params.set("q", filters.q);
    const query = params.toString();
    return (await this.authed(`/packages/${query ? `?${query}` : ""}`, { method: "GET" }, packageList)).packages;
  }

  async getPackage(id: string): Promise<DeliveryPackage> {
    return (await this.authed(`/packages/${id}`, { method: "GET" }, packageEnvelope)).package;
  }

  async createPackage(input: PackageInput): Promise<DeliveryPackage> {
    return (await this.authed("/packages/", { method: "POST", body: input }, packageEnvelope)).package;
  }

  async updatePackage(id: string, version: number, changes: Partial<Omit<PackageInput, "driver_id">>): Promise<DeliveryPackage> {
    return (await this.authed(`/packages/${id}`, { method: "PATCH", body: { ...changes, version } }, packageEnvelope)).package;
  }

  async assignPackage(id: string, version: number, driverId: string | null): Promise<DeliveryPackage> {
    return (await this.authed(`/packages/${id}/assign`, { method: "POST", body: { version, driver_id: driverId } }, packageEnvelope))
      .package;
  }

  async bulkAssignPackages(packageIds: string[], driverId: string | null) {
    return this.authed("/packages/assign", { method: "POST", body: { package_ids: packageIds, driver_id: driverId } }, bulkAssignResult);
  }

  async setPackageStatus(id: string, version: number, status: "CANCELLED" | "RETURNED", reason = ""): Promise<DeliveryPackage> {
    return (await this.authed(`/packages/${id}/status`, { method: "POST", body: { version, status, reason } }, packageEnvelope))
      .package;
  }

  async packageEvents(id: string): Promise<PackageEvent[]> {
    return (await this.authed(`/packages/${id}/events`, { method: "GET" }, packageEvents)).events;
  }

  // --- Importación (etapa 1) ------------------------------------------------------------------

  async uploadImport(file: Blob, filename: string): Promise<ImportJob> {
    const form = new FormData();
    form.append("file", file, filename);
    return (await this.authed("/imports/", { method: "POST", body: form }, importEnvelope)).import;
  }

  async previewImport(id: string, mapping: ColumnMapping): Promise<ImportPreview> {
    return this.authed(`/imports/${id}/preview`, { method: "POST", body: { mapping } }, importPreview);
  }

  async confirmImport(id: string, mapping: ColumnMapping): Promise<ImportJob> {
    return (await this.authed(`/imports/${id}/confirm`, { method: "POST", body: { mapping } }, importEnvelope)).import;
  }

  // --- Entrega en la calle (etapa 1, ADR-013) ----------------------------------------------

  /** Idempotente por `id` (generado en el teléfono): reenviar no duplica. */
  async recordVisit(body: {
    id: string;
    package_id: string;
    workday_id?: string | null;
    started_at: string;
    ended_at?: string | null;
    outcome: VisitOutcome;
    attribution?: "RECIPIENT" | "LOGISTIC" | "NONE" | null;
    notes?: string;
    start_location?: { lat: number; lng: number; accuracy?: number | null } | null;
    end_location?: { lat: number; lng: number; accuracy?: number | null } | null;
  }): Promise<{ visit: VisitRecord; package_status: string }> {
    return this.authed("/visits", { method: "POST", body }, visitCreated);
  }

  async uploadEvidence(
    meta: { id: string; package_id: string; visit_id?: string | null; captured_at: string; reason?: string; lat?: number | null; lng?: number | null },
    photo: Blob,
  ): Promise<void> {
    const form = new FormData();
    for (const [key, value] of Object.entries(meta)) if (value !== undefined && value !== null) form.append(key, String(value));
    const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
    form.append("file", photo, `${meta.id}.${ext}`);
    await this.authed("/evidence", { method: "POST", body: form }, anything);
  }

  async recordCommunication(body: { id: string; package_id: string; channel: "PHONE" | "WHATSAPP"; started_at: string }): Promise<void> {
    await this.authed("/communications", { method: "POST", body }, anything);
  }

  /** Carga con escaneo (ADR-014): los códigos asignados al repartidor pasan a "En camino". */
  async loadPackages(trackingCodes: string[]): Promise<Array<{ code: string; result: string; package_id?: string }>> {
    const body = (await this.authed("/packages/load", { method: "POST", body: { tracking_codes: trackingCodes } }, anything)) as {
      results: Array<{ code: string; result: string; package_id?: string }>;
    };
    return body.results;
  }

  // --- Armar mi ruta (ADR-015) --------------------------------------------------------------

  async getRoute(): Promise<Route> {
    return this.authed("/route", { method: "GET" }, route);
  }

  async optimizeRoute(start: { lat: number; lng: number }): Promise<Route> {
    return this.authed("/route/optimize", { method: "POST", body: start }, route);
  }

  async saveRoute(packageIds: string[]): Promise<Route> {
    return this.authed("/route", { method: "PUT", body: { package_ids: packageIds } }, route);
  }

  async packageVisits(packageId: string): Promise<VisitRecord[]> {
    return (await this.authed(`/packages/${packageId}/visits`, { method: "GET" }, packageVisits)).visits;
  }

  /** La foto de una visita (la API exige la sesión: no hay URL pública). */
  async evidencePhoto(evidenceId: string): Promise<Blob> {
    if (!this.accessToken) await this.refresh();
    let response = await this.raw(`/evidence/${evidenceId}/file`, { method: "GET" }, this.accessToken);
    if (response.status === 401 && (await this.refresh())) {
      response = await this.raw(`/evidence/${evidenceId}/file`, { method: "GET" }, this.accessToken);
    }
    if (!response.ok) throw new ApiError(response.status, await readJson(response));
    return response.blob();
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

  private async authed<T>(path: string, init: RequestInit_, schema: z.ZodType<T> | { parse(v: unknown): T }): Promise<T> {
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
    // Las lecturas (GET) son idempotentes: si falla la red o el túnel/proxy no llega al servidor
    // (502/503/504, 530 de Cloudflare), se reintenta UNA vez después de un instante. Los cortes de
    // pocos segundos ni se notan. Las escrituras no: tienen su propia cola con reintentos.
    if (init.method !== "GET") return this.send(path, init, bearer);
    try {
      const response = await this.send(path, init, bearer);
      if (!GATEWAY_ERRORS.has(response.status)) return response;
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, this.getRetryDelayMs));
    return this.send(path, init, bearer);
  }

  private async send(path: string, init: RequestInit_, bearer?: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json", ...init.headers };
    // Un FormData (subida de archivos) lleva su propio Content-Type con el separador.
    const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
    if (init.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    try {
      return await this.fetchImpl(`${this.base}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
        credentials: "include",
      });
    } catch (error) {
      throw new NetworkError(error);
    }
  }
}

/** Respuestas que no se validan (alcanza con que sean 2xx). */
const anything = { parse: (value: unknown) => value };

/** Respuestas de un intermediario (proxy, túnel) que no llegó al servidor. */
const GATEWAY_ERRORS = new Set([502, 503, 504, 530]);

interface RequestInit_ {
  method: "GET" | "POST" | "PATCH" | "PUT";
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
