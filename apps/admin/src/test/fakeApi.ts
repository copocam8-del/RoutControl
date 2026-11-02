/**
 * API falsa para las pruebas del panel (sin Docker). Responde lo mismo que el backend real en
 * los endpoints que usa el panel; el contrato real lo prueban `src/integration/*.real.ts`.
 */
import type { DriverSummary, WorkdayWithDriver } from "@routcontrol/domain";

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
    const body = init?.body ? JSON.parse(String(init.body)) : {};
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
