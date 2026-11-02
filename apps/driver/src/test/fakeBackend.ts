/**
 * Backend falso para las pruebas del front, sin Docker. Reproduce las reglas del backend real que
 * le importan al teléfono (ADR-003 y ADR-005):
 *   - idempotencia por point_id (accepted / duplicates) y por workday_id al iniciar;
 *   - ventana estricta de la jornada (before_workday_start / after_workday_end);
 *   - token de seguimiento por jornada (401 si no existe o fue revocado);
 *   - access token corto + refresh por "cookie" (acá, un flag).
 * NO reemplaza las pruebas del backend: solo permite probar el teléfono contra el contrato.
 *
 * Lo que este backend falso NO reproduce (lo cubren las pruebas contra el Django real,
 * `src/integration/realBackend.real.ts`, con `pnpm --filter @routcontrol/driver test:real`):
 *   - la rotación del refresh en cada uso y la detección de reuso (ADR-005);
 *   - la verificación del Origin en refresh/logout;
 *   - la ventana de gracia del token después del fin (acá el token sirve para siempre);
 *   - el rechazo de puntos "en el futuro" (recorded_in_future) y las fechas con microsegundos.
 */
interface FakeWorkday {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: "ACTIVE" | "FINISHED";
  device_id: string;
  token: string;
}

export interface FakeUser {
  email: string;
  password: string;
  role: "DRIVER" | "OWNER";
  orgs?: Array<{ id: string; name: string }>;
}

const ORG = { id: "0192f3a0-0000-7000-8000-000000000001", name: "Empresa de prueba (demo)" };
const USER_ID = "0192f3a0-0000-7000-8000-0000000000aa";

export class FakeBackend {
  online = true;
  /** Próximas respuestas forzadas, por ruta (por ejemplo, un 500). */
  forced = new Map<string, number[]>();
  /** Cortes de red puntuales por ruta (como el corte del túnel): cuántas veces falla antes de andar. */
  networkFailures = new Map<string, number>();
  users: FakeUser[] = [{ email: "repartidor@demo.test", password: "secreta", role: "DRIVER" }];
  points = new Map<string, Record<string, unknown>>();
  workdays = new Map<string, FakeWorkday>();
  calls: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }> = [];
  refreshCookie: string | null = null;
  accessTokens = new Set<string>();
  revokedTokens = new Set<string>();
  /** Paquetes asignados al repartidor (GET /packages/). */
  packages: Array<Record<string, any>> = [];
  visits = new Map<string, Record<string, unknown>>();
  routeOrder: string[] = [];
  routeSource: "OPTIMIZED" | "MANUAL" | null = null;
  routeStart: unknown = null;
  routingDown = false;
  evidence = new Map<string, Record<string, unknown>>();
  communications = new Map<string, Record<string, unknown>>();
  /** POST /workdays/{id}/tracking-token responde 409 (gracia vencida), como el servidor real. */
  recoveryRefused = false;
  private counter = 0;
  private currentUser: FakeUser | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}));
    const body =
      init?.body instanceof FormData
        ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : { size: (v as Blob).size, type: (v as Blob).type }]))
        : init?.body
          ? JSON.parse(String(init.body))
          : undefined;
    this.calls.push({ method: init?.method ?? "GET", path, body, headers });
    if (!this.online) throw new TypeError("Failed to fetch");
    const failures = this.networkFailures.get(path) ?? 0;
    if (failures > 0) {
      this.networkFailures.set(path, failures - 1);
      throw new TypeError("Failed to fetch (corte simulado)");
    }
    const forced = this.forced.get(path)?.shift();
    if (forced) return json(forced, { detail: `forzado ${forced}` });
    return this.route(init?.method ?? "GET", path, body, headers);
  };

  callsTo(path: string) {
    return this.calls.filter((c) => c.path === path);
  }

  private route(method: string, path: string, body: any, headers: Record<string, string>): Response {
    if (path === "/auth/login") return this.login(body);
    if (path === "/auth/refresh") {
      if (!this.refreshCookie) return json(401, { detail: "Sin sesión." });
      return json(200, { access: this.issueAccess() });
    }
    if (path === "/auth/logout") {
      this.refreshCookie = null;
      return new Response(null, { status: 204 });
    }
    if (path === "/tracking/batch") return this.batch(body, headers);

    const bearer = headers.Authorization?.replace(/^Bearer /, "");
    if (!bearer || !this.accessTokens.has(bearer)) return json(401, { detail: "Token inválido" });
    const user = this.currentUser!;

    if (path === "/auth/me") return json(200, this.sessionBody(user, false));
    if (path === "/workdays/current") {
      const w = [...this.workdays.values()].find((x) => x.status === "ACTIVE");
      return json(200, { workday: w ? this.wire(w) : null });
    }
    if (path === "/workdays/start" && method === "POST") return this.start(body);
    if (path === "/workdays/" && method === "GET") {
      const list = [...this.workdays.values()].sort((a, b) => b.started_at.localeCompare(a.started_at));
      return json(200, { workdays: list.map((w) => ({ ...this.wire(w), driver: { id: USER_ID, name: "Repartidor de prueba" } })) });
    }
    const track = /^\/workdays\/([^/]+)\/track$/.exec(path);
    if (track && method === "GET") return this.track(track[1]!);
    if (path === "/packages/" && method === "GET") return json(200, { packages: this.packages });
    if (path === "/visits" && method === "POST") return this.visit(body);
    if (path === "/route" && method === "GET") return json(200, this.routeWire());
    if (path === "/route" && method === "PUT") {
      this.routeOrder = body.package_ids;
      this.routeSource = "MANUAL";
      return json(200, this.routeWire());
    }
    if (path === "/route/optimize" && method === "POST") {
      if (this.routingDown) return json(503, { code: "routing_unavailable", detail: "No se pudo armar la ruta ahora. Podés ordenar las paradas a mano." });
      this.routeStart = body;
      // "Optimiza" invirtiendo el orden de los pendientes (alcanza para probar el teléfono).
      this.routeOrder = this.packages.filter((p) => ["ASSIGNED", "IN_ROUTE", "FAILED", "RESCHEDULED"].includes(p.status)).map((p) => p.id).reverse();
      this.routeSource = "OPTIMIZED";
      return json(200, this.routeWire());
    }
    if (path === "/packages/load" && method === "POST") {
      const results = (body.tracking_codes as string[]).map((code) => {
        const pkg = this.packages.find((p) => p.tracking_code === code);
        if (!pkg) return { code, result: "not_assigned" };
        if (pkg.status === "IN_ROUTE") return { code, result: "already_loaded", package_id: pkg.id };
        pkg.status = "IN_ROUTE";
        return { code, result: "loaded", package_id: pkg.id };
      });
      return json(200, { results });
    }
    if (path === "/evidence" && method === "POST") {
      if (!this.visits.has(body.visit_id)) return json(409, { code: "visit_not_found", detail: "La visita de la foto no existe (todavía no llegó)." });
      const created = !this.evidence.has(body.id);
      this.evidence.set(body.id, body);
      return json(created ? 201 : 200, { evidence: { id: body.id, upload_status: "UPLOADED", sha256: "x" } });
    }
    if (path === "/communications" && method === "POST") {
      const created = !this.communications.has(body.id);
      this.communications.set(body.id, body);
      return json(created ? 201 : 200, { communication: { id: body.id } });
    }
    const recover = /^\/workdays\/([^/]+)\/tracking-token$/.exec(path);
    if (recover && method === "POST") return this.recover(recover[1]!);
    const end = /^\/workdays\/([^/]+)\/end$/.exec(path);
    if (end && method === "POST") return this.end(end[1]!, body);
    return json(404, { detail: "No encontrado" });
  }

  private login(body: { email: string; password: string; organization_id?: string }): Response {
    const user = this.users.find((u) => u.email === body.email && u.password === body.password);
    if (!user) return json(401, { detail: "Email o contraseña incorrectos." });
    if (user.orgs && user.orgs.length > 1 && !body.organization_id) {
      return json(409, {
        code: "choose_organization",
        organizations: user.orgs.map((o) => ({ ...o, role: user.role })),
      });
    }
    this.currentUser = user;
    this.refreshCookie = `refresh-${++this.counter}`;
    return json(200, this.sessionBody(user, true));
  }

  private sessionBody(user: FakeUser, withAccess: boolean) {
    return {
      ...(withAccess ? { access: this.issueAccess() } : {}),
      user: { id: USER_ID, email: user.email, full_name: "Repartidor de prueba" },
      organization: ORG,
      role: user.role,
    };
  }

  private issueAccess(): string {
    const token = `access-${++this.counter}`;
    this.accessTokens.add(token);
    return token;
  }

  /** Simula que venció el access token (15 min). */
  expireAccessTokens(): void {
    this.accessTokens.clear();
  }

  private start(body: { workday_id: string; started_at: string; device: { id: string } }): Response {
    const existing = this.workdays.get(body.workday_id);
    if (existing) {
      if (existing.status !== "ACTIVE") return json(409, { code: "workday_id_in_use", detail: "Ese id ya se usó." });
      this.revokedTokens.add(existing.token);
      existing.token = `tracking-${++this.counter}-xxxxxxxxxxxxxxxxxxxx`;
      return json(200, this.startBody(existing));
    }
    const active = [...this.workdays.values()].find((w) => w.status === "ACTIVE");
    if (active) {
      return json(409, { code: "workday_already_active", detail: "Ya tenés una jornada iniciada.", workday: this.wire(active) });
    }
    const w: FakeWorkday = {
      id: body.workday_id,
      started_at: body.started_at,
      ended_at: null,
      status: "ACTIVE",
      device_id: body.device.id,
      token: `tracking-${++this.counter}-xxxxxxxxxxxxxxxxxxxx`,
    };
    this.workdays.set(w.id, w);
    return json(201, this.startBody(w));
  }

  private startBody(w: FakeWorkday) {
    return {
      workday: this.wire(w),
      tracking_token: w.token,
      tracking_token_expires_at: new Date(this.now() + 14 * 3600_000).toISOString(),
    };
  }

  private end(id: string, body: { ended_at: string }): Response {
    const w = this.workdays.get(id);
    if (!w) return json(404, { detail: "Jornada no encontrada." });
    if (w.status === "ACTIVE") {
      w.status = "FINISHED";
      w.ended_at = body.ended_at;
    }
    return json(200, { workday: this.wire(w) });
  }

  private routeWire() {
    return {
      stops: this.routeOrder.map((id, i) => ({ package_id: id, sequence: i + 1, eta_s: this.routeSource === "OPTIMIZED" ? 300 : null, distance_m: this.routeSource === "OPTIMIZED" ? 1500 : null })),
      source: this.routeOrder.length ? this.routeSource : null,
      total_eta_s: this.routeSource === "OPTIMIZED" ? 300 * this.routeOrder.length : null,
      total_distance_m: this.routeSource === "OPTIMIZED" ? 1500 * this.routeOrder.length : null,
    };
  }

  private visit(body: Record<string, any>): Response {
    const pkg = this.packages.find((p) => p.id === body.package_id);
    if (!pkg) return json(404, { detail: "Paquete no encontrado." });
    if (this.visits.has(body.id)) return json(200, { visit: this.visitWire(body), package_status: pkg.status });
    if (!["ASSIGNED", "IN_ROUTE", "FAILED", "RESCHEDULED"].includes(pkg.status)) {
      return json(409, { code: "not_visitable", detail: "El paquete no admite otra visita." });
    }
    this.visits.set(body.id, body);
    pkg.status = body.outcome === "DELIVERED" ? "DELIVERED" : body.outcome === "RESCHEDULE_REQUESTED" ? "RESCHEDULED" : "FAILED";
    return json(201, { visit: this.visitWire(body), package_status: pkg.status });
  }

  private visitWire(body: Record<string, any>) {
    return {
      id: body.id,
      package_id: body.package_id,
      driver: "Repartidor de prueba",
      started_at: body.started_at,
      ended_at: body.ended_at ?? null,
      duration_s: null,
      outcome: body.outcome,
      outcome_attribution: "NONE",
      notes: body.notes ?? "",
      is_second_attempt: false,
      end_location: null,
      evidence: [],
    };
  }

  private recover(id: string): Response {
    const w = this.workdays.get(id);
    if (!w) return json(404, { detail: "Jornada no encontrada." });
    if (this.recoveryRefused) {
      return json(409, { code: "grace_expired", detail: "Pasó el plazo para enviar los puntos de esta jornada; no se pueden recuperar." });
    }
    this.revokedTokens.add(w.token);
    w.token = `tracking-${++this.counter}-xxxxxxxxxxxxxxxxxxxx`;
    return json(201, { tracking_token: w.token, tracking_token_expires_at: new Date(this.now() + 72 * 3600_000).toISOString() });
  }

  private batch(body: { points: Array<Record<string, any>> }, headers: Record<string, string>): Response {
    const token = headers.Authorization?.replace(/^Tracking /, "");
    const w = [...this.workdays.values()].find((x) => x.token === token);
    if (!token || !w || this.revokedTokens.has(token)) return json(401, { detail: "Token de seguimiento inválido." });
    const result = { accepted: [] as string[], duplicates: [] as string[], rejected: [] as unknown[], server_time: new Date(this.now()).toISOString() };
    for (const p of body.points) {
      const t = Date.parse(p.recorded_at);
      if (t < Date.parse(w.started_at)) {
        result.rejected.push({ id: p.point_id, reason: "before_workday_start", detail: "Antes del inicio." });
      } else if (w.ended_at && t > Date.parse(w.ended_at)) {
        result.rejected.push({ id: p.point_id, reason: "after_workday_end", detail: "Después del fin." });
      } else if (this.points.has(p.point_id)) {
        result.duplicates.push(p.point_id);
      } else {
        this.points.set(p.point_id, { ...p, workday_id: w.id });
        result.accepted.push(p.point_id);
      }
    }
    return json(200, result);
  }

  /** Recorrido simplificado: un solo tramo con todos los puntos y los huecos que se carguen a mano. */
  trackGaps: Array<{ from_at: string; to_at: string; seconds: number; reason: string; from: number[] | null; to: number[] | null }> = [];

  private track(id: string): Response {
    const w = this.workdays.get(id);
    if (!w) return json(404, { detail: "Jornada no encontrada." });
    const pts = [...this.points.values()].filter((p) => p.workday_id === id) as Array<Record<string, any>>;
    const coords = pts.map((p) => [p.lng, p.lat]);
    return json(200, {
      workday: { ...this.wire(w), driver: { id: USER_ID, name: "Repartidor de prueba" } },
      segments: {
        type: "FeatureCollection",
        features: coords.length
          ? [{ type: "Feature", geometry: coords.length > 1 ? { type: "LineString", coordinates: coords } : { type: "Point", coordinates: coords[0] }, properties: { segment: 0 } }]
          : [],
      },
      points: {
        type: "FeatureCollection",
        features: pts.map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
          properties: { recorded_at: p.recorded_at, accuracy_m: p.accuracy, source: p.source ?? "FOREGROUND", event: p.event ?? "" },
        })),
      },
      gaps: this.trackGaps,
      stats: { point_count: pts.length, segment_count: coords.length ? 1 : 0, distance_m: 1234.5, gap_count: this.trackGaps.length, gap_seconds: this.trackGaps.reduce((a, g) => a + g.seconds, 0) },
    });
  }

  private wire(w: FakeWorkday) {
    return {
      id: w.id,
      status: w.status,
      tracking_mode: "EVENTS_ONLY",
      date: w.started_at.slice(0, 10),
      started_at: w.started_at,
      ended_at: w.ended_at,
      device_id: w.device_id,
    };
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
