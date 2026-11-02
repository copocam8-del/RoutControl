/**
 * API falsa para las pruebas del panel (sin Docker). Responde lo mismo que el backend real en
 * los endpoints que usa el panel; el contrato real lo prueban `src/integration/*.real.ts`.
 */
import type { DeliveryPackage, DeliveryRecord, DriverSummary, Incident, WorkdayWithDriver } from "@routcontrol/domain";

const ORG = { id: "0192f3a0-0000-7000-8000-00000000a001", name: "Demo Norte (DATOS DE DEMOSTRACIÓN)", is_demo: true };

export interface FakeUser {
  email: string;
  password: string;
  role: "OWNER" | "ADMIN" | "SUPERVISOR" | "DRIVER";
}

export class FakeApi {
  users: FakeUser[] = [
    { email: "duenio@norte.demo", password: "demo", role: "OWNER" },
    { email: "repartidor1@norte.demo", password: "demo", role: "DRIVER" },
  ];
  workdays: WorkdayWithDriver[] = [];
  drivers: DriverSummary[] = [];
  packages: DeliveryPackage[] = [];
  deliveries: DeliveryRecord[] = [];
  incidents: Incident[] = [];
  /** Historial de domicilios (GET /addresses/{id}). */
  addresses = new Map<string, unknown>();
  /** Segundos intentos (ADR-023): la sugerencia que devuelve el servidor al pedirlo. */
  secondAttempts: Array<Record<string, unknown>> = [];
  /** Informes (ADR-024): lo que devuelve /reports, y los pedidos recibidos. */
  reportDrivers: Array<Record<string, unknown>> = [];
  reportQueries: string[] = [];
  nextSuggestion: Record<string, unknown> = {
    suggestion: "INSERT",
    suggestion_reason: "Insertarlo después de la parada 2: suma unos 6 min de recorrido.",
    distance_m: 1800,
    detour_s: 360,
    pending_count: 5,
    insert_position: 2,
  };
  bulkAssigned: Array<{ ids: string[]; driver: string | null }> = [];
  /** Respuesta de la importación (subida, vista previa y confirmación). */
  importHeaders = ["Guía", "Destinatario", "Dirección"];
  calls: string[] = [];
  /** Cortes de red por ruta (cuántas veces falla). */
  networkFailures = new Map<string, number>();
  private current: FakeUser | null = null;
  private loggedIn = false;

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname.replace(/^\/api\/v1/, "");
    this.calls.push(`${init?.method ?? "GET"} ${path}${url.search}`);
    const failures = this.networkFailures.get(path) ?? 0;
    if (failures > 0) {
      this.networkFailures.set(path, failures - 1);
      throw new TypeError("Failed to fetch");
    }
    const body = init?.body instanceof FormData ? {} : init?.body ? JSON.parse(String(init.body)) : {};
    if (path === "/auth/login") {
      const user = this.users.find((u) => u.email === body.email && u.password === body.password);
      if (!user) return json(401, { detail: "Email o contraseña incorrectos." });
      this.current = user;
      this.loggedIn = true;
      return json(200, { access: "access", ...this.me() });
    }
    if (path === "/auth/refresh") return this.loggedIn ? json(200, { access: "access" }) : json(401, { detail: "Sin sesión." });
    if (path === "/auth/logout") {
      this.loggedIn = false;
      return new Response(null, { status: 204 });
    }
    if (!this.loggedIn) return json(401, { detail: "Sin sesión." });
    if (path === "/auth/me") return json(200, this.me());
    if (path === "/workdays/") {
      const date = url.searchParams.get("date");
      return json(200, { workdays: this.workdays.filter((w) => !date || w.date === date) });
    }
    if (path === "/drivers/") return json(200, { drivers: this.drivers });
    if (path === "/packages/" && (init?.method ?? "GET") === "GET") return json(200, { packages: this.packages });
    if (path === "/packages/" && init?.method === "POST") {
      if (this.packages.some((p) => p.tracking_code === body.tracking_code)) {
        return json(409, { code: "duplicate_tracking_code", detail: `Ya existe un paquete con el código ${body.tracking_code}.` });
      }
      const created = fakePackage({ tracking_code: body.tracking_code, recipient_name: body.recipient_name, address: { ...fakePackage().address, raw_text: body.address.raw_text } });
      this.packages.push(created);
      return json(201, { package: created });
    }
    if (path === "/packages/assign") {
      this.bulkAssigned.push({ ids: body.package_ids, driver: body.driver_id });
      for (const p of this.packages) {
        if (body.package_ids.includes(p.id)) {
          p.status = body.driver_id ? "ASSIGNED" : "CREATED";
          p.assigned_driver = body.driver_id ? { id: body.driver_id, name: this.drivers.find((d) => d.id === body.driver_id)?.name ?? "?" } : null;
        }
      }
      return json(200, { assigned: body.package_ids, failed: [] });
    }
    const ask = /^\/packages\/([^/]+)\/second-attempt$/.exec(path);
    if (ask) {
      const p = this.packages.find((x) => x.id === ask[1])!;
      const body = JSON.parse(String(init?.body ?? "{}"));
      const req = {
        id: `0192f3a0-0000-7000-8004-${String(this.secondAttempts.length + 1).padStart(12, "0")}`,
        package: { id: p.id, tracking_code: p.tracking_code, recipient_name: p.recipient_name, address: p.address.raw_text, status: p.status },
        requested_at: new Date().toISOString(),
        window_start: body.window_start ?? null,
        window_end: body.window_end ?? null,
        note: body.note ?? "",
        decision: "PENDING",
        placement: null,
        decided_at: null,
        ...this.nextSuggestion,
      };
      this.secondAttempts.unshift(req);
      return json(201, { second_attempt: req });
    }
    if (path === "/reports" || path === "/reports/export") {
      this.reportQueries.push(url.search);
      if (path === "/reports/export") return new Response(new Blob(["x"]), { status: 200, headers: { "Content-Type": "text/csv" } });
      const sum = (k: string) => this.reportDrivers.reduce((n, d) => n + Number(d[k] ?? 0), 0);
      const keys = ["workdays", "hours", "distance_km", "events_only_workdays", "no_signal_minutes", "visits", "delivered", "failed", "failed_recipient", "failed_logistic", "second_attempts"];
      const total: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, sum(k)]));
      total.delivery_rate = sum("delivered") + sum("failed") ? sum("delivered") / (sum("delivered") + sum("failed")) : null;
      total.avg_visit_minutes = null;
      const kind = url.searchParams.get("period") ?? "week";
      return json(200, { period: { kind, from: "2026-11-02", to: "2026-11-08", label: kind === "month" ? "Noviembre de 2026" : "Semana del 2/11/2026 al 8/11/2026" }, drivers: this.reportDrivers, total });
    }
    if (path === "/second-attempts") {
      const pk = url.searchParams.get("package");
      return json(200, { second_attempts: this.secondAttempts.filter((r) => !pk || (r.package as { id: string }).id === pk) });
    }
    const decide = /^\/second-attempts\/([^/]+)\/decide$/.exec(path);
    if (decide) {
      const r = this.secondAttempts.find((x) => x.id === decide[1])!;
      const body = JSON.parse(String(init?.body ?? "{}"));
      r.decision = body.accept ? "ACCEPTED" : "REJECTED";
      r.placement = body.accept ? (body.placement ?? r.suggestion) : null;
      r.decided_at = new Date().toISOString();
      const p = this.packages.find((x) => x.id === (r.package as { id: string }).id)!;
      if (body.accept) p.status = r.placement === "NEXT_DAY" ? "RESCHEDULED" : "ASSIGNED";
      return json(200, { second_attempt: r });
    }
    const pkg = /^\/packages\/([^/]+)(\/(events|visits))?$/.exec(path);
    if (pkg) {
      const p = this.packages.find((x) => x.id === pkg[1]);
      if (!p) return json(404, { detail: "Paquete no encontrado." });
      if (pkg[3] === "events") return json(200, { events: [{ id: "0192f3a0-0000-7000-8000-0000000000e9", type: "created", from_status: "", to_status: "CREATED", actor: "Dueña Norte (demo)", payload: { source: "MANUAL" }, occurred_at: p.created_at }] });
      if (pkg[3] === "visits") return json(200, { visits: this.deliveries.filter((d) => d.package.id === p.id) });
      return json(200, { package: p });
    }
    if (path === "/imports/") return json(201, { import: this.importJob("UPLOADED") });
    if (/^\/imports\/[^/]+\/preview$/.test(path)) {
      return json(200, {
        summary: { total_rows: 3, ok_rows: 2, error_rows: 1 },
        rows: [],
        errors: [{ row: 4, field: "tracking_code", message: "Código repetido (también en la fila 2)." }],
      });
    }
    if (/^\/imports\/[^/]+\/confirm$/.test(path)) {
      this.lastMapping = body.mapping;
      return json(200, { import: { ...this.importJob("DONE"), ok_rows: 2, error_rows: 1, errors: [{ row: 4, field: "tracking_code", message: "Código repetido (también en la fila 2)." }] } });
    }
    if (path === "/deliveries") return json(200, { date: url.searchParams.get("date") ?? "2026-11-02", deliveries: this.deliveries });
    if (path === "/incidents") {
      const st = url.searchParams.get("status");
      return json(200, { incidents: this.incidents.filter((i) => !st || i.status === st) });
    }
    const address = /^\/addresses\/([^/]+)$/.exec(path);
    if (address) return this.addresses.has(address[1]!) ? json(200, this.addresses.get(address[1]!)) : json(404, { detail: "Domicilio no encontrado." });
    const resolve = /^\/incidents\/([^/]+)\/resolve$/.exec(path);
    if (resolve) {
      const i = this.incidents.find((x) => x.id === resolve[1])!;
      i.status = "RESOLVED";
      i.resolved_by = "Dueña Norte (demo)";
      i.resolved_at = new Date().toISOString();
      return json(200, { incident: i });
    }
    const track = /^\/workdays\/([^/]+)\/track$/.exec(path);
    if (track) {
      const w = this.workdays.find((x) => x.id === track[1]);
      if (!w) return json(404, { detail: "Jornada no encontrada." });
      const coords = w.point_count ? [[-58.4, -34.6], [-58.41, -34.61]] : [];
      return json(200, {
        workday: w,
        segments: {
          type: "FeatureCollection",
          features: coords.length ? [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { segment: 0 } }] : [],
        },
        points: {
          type: "FeatureCollection",
          features: coords.map((c) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: c },
            properties: { recorded_at: w.started_at, accuracy_m: 8, source: "FOREGROUND", event: "" },
          })),
        },
        gaps: w.point_count ? [{ from_at: w.started_at, to_at: w.started_at, seconds: 900, reason: "desconocido", from: coords[0], to: coords[1] }] : [],
        stats: { point_count: w.point_count, segment_count: coords.length ? 1 : 0, distance_m: 2500, gap_count: w.point_count ? 1 : 0, gap_seconds: w.point_count ? 900 : 0 },
      });
    }
    return json(404, { detail: "No encontrado" });
  };

  lastMapping: Record<string, string | null> | null = null;

  private importJob(status: "UPLOADED" | "DONE") {
    return {
      id: "0192f3a0-0000-7000-8000-0000000000f1",
      filename: "envios.csv",
      status,
      headers: this.importHeaders,
      sample: status === "DONE" ? [] : [["G-1", "Ana", "Mitre 100"]],
      total_rows: 3,
      column_mapping: {},
      suggested_mapping: { tracking_code: "Guía", recipient_name: "Destinatario", address: null },
      fields: [
        { key: "tracking_code", label: "Código de seguimiento", required: true },
        { key: "recipient_name", label: "Destinatario", required: false },
        { key: "address", label: "Dirección completa", required: false },
      ],
      ok_rows: 0,
      error_rows: 0,
      errors: [],
      created_at: "2026-11-02T10:00:00Z",
      finished_at: status === "DONE" ? "2026-11-02T10:01:00Z" : null,
    };
  }

  private me() {
    return {
      user: { id: "0192f3a0-0000-7000-8000-00000000b001", email: this.current!.email, full_name: "Dueña Norte (demo)" },
      organization: ORG,
      role: this.current!.role,
    };
  }
}

let seq = 0;

/** Repartidor de demostración. `working`: con jornada en curso y ubicación; `silent`: sin señal hace 30 min. */
export function driver(name: string, working: boolean, silent = false): DriverSummary {
  seq += 1;
  const started = new Date(Date.now() - 2 * 3600_000).toISOString();
  return {
    id: `0192f3a0-0000-7000-8000-${String(seq + 900).padStart(12, "0")}`,
    name,
    email: `${name.split(" ")[0]!.toLowerCase()}@norte.demo`,
    employee_code: "",
    vehicle_type: "",
    status: "ACTIVE",
    membership_status: "ACTIVE",
    active_workday: working
      ? {
          id: `0192f3a0-0000-7000-8000-${String(seq + 950).padStart(12, "0")}`,
          started_at: started,
          last_point_at: new Date(Date.now() - (silent ? 30 : 1) * 60_000).toISOString(),
          last_location: { lat: -34.6 - seq / 1000, lng: -58.4 },
        }
      : null,
    last_workday: null,
  };
}
export function workday(overrides: Partial<WorkdayWithDriver> = {}): WorkdayWithDriver {
  seq += 1;
  const id = `0192f3a0-0000-7000-8000-${String(seq).padStart(12, "0")}`;
  return {
    id,
    status: "ACTIVE",
    tracking_mode: "EVENTS_ONLY",
    date: "2026-11-01",
    started_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    ended_at: null,
    device_id: "0192f3a0-0000-7000-8000-00000000c001",
    driver: { id: `0192f3a0-0000-7000-8000-${String(seq + 500).padStart(12, "0")}`, name: `Repartidor ${seq} (demo)` },
    point_count: 12,
    gap_count: 0,
    last_point_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    ...overrides,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let pkgSeq = 0;
/** Paquete de ejemplo para las pruebas del panel (datos de prueba). */
export function fakePackage(overrides: Partial<DeliveryPackage> = {}): DeliveryPackage {
  pkgSeq += 1;
  const n = String(pkgSeq).padStart(12, "0");
  return {
    id: `0192f3a0-0000-7000-a000-${n}`,
    tracking_code: `P-${pkgSeq}`,
    source: "MANUAL",
    status: "CREATED",
    recipient_name: `Destinatario ${pkgSeq} (prueba)`,
    recipient_phone: "",
    notes: "",
    address: { id: `0192f3a0-0000-7000-b000-${n}`, raw_text: `Calle ${pkgSeq}00`, street: "", number: "", floor_unit: "", locality: "", province: "", postal_code: "", location: null },
    assigned_driver: null,
    assigned_at: null,
    version: 1,
    created_at: "2026-11-02T09:00:00Z",
    updated_at: "2026-11-02T09:00:00Z",
    ...overrides,
  };
}
