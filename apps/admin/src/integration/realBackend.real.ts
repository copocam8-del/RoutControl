/**
 * El panel contra el Django REAL, por el proxy de Vite (http://localhost:5174/api → :8000).
 * Valida con zod las respuestas reales de los endpoints que usa el panel.
 */
import { ApiClient, ApiError } from "@routcontrol/api-client";
import { beforeAll, describe, expect, it } from "vitest";

import { today } from "../router";
import { AdminSession, NOT_STAFF } from "../session";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const ORIGIN = env.RC_ADMIN_ORIGIN ?? "http://localhost:5174";
const PASSWORD = env.DEMO_PASSWORD ?? "routcontrol-demo";

/** fetch que guarda la cookie de refresh (por Path) y manda el Origin, como el navegador. */
function browserFetch(): typeof fetch {
  const jar = new Map<string, { value: string; path: string }>();
  return async (input, init = {}) => {
    const url = new URL(String(input), ORIGIN);
    const headers = new Headers(init.headers);
    const cookies = [...jar].filter(([, c]) => url.pathname.startsWith(c.path)).map(([n, c]) => `${n}=${c.value}`);
    if (cookies.length) headers.set("Cookie", cookies.join("; "));
    if ((init.method ?? "GET") !== "GET") headers.set("Origin", ORIGIN);
    const response = await fetch(url, { ...init, headers, credentials: undefined });
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";").map((s) => s.trim());
      const [name, ...rest] = pair!.split("=");
      const path = attrs.find((a) => a.toLowerCase().startsWith("path="))?.slice(5) ?? "/";
      jar.set(name!, { value: rest.join("="), path });
    }
    return response;
  };
}

const client = () => new ApiClient(`${ORIGIN}/api/v1`, browserFetch());

beforeAll(async () => {
  const response = await fetch(`${ORIGIN}/api/v1/schema/`).catch(() => null);
  if (!response?.ok) throw new Error(`No responde ${ORIGIN}/api/v1 (¿están corriendo el panel y Django?)`);
});

describe("panel contra el backend real", () => {
  it("el dueño entra y la empresa viene marcada como demo", async () => {
    const api = client();
    const session = new AdminSession(api);
    await session.login("duenio@norte.demo", PASSWORD);
    const state = session.getState();
    expect(state.status).toBe("authenticated");
    if (state.status === "authenticated") {
      expect(state.session.role).toBe("OWNER");
      expect(state.session.organization.is_demo).toBe(true);
    }
  });

  it("un repartidor no entra al panel", async () => {
    const session = new AdminSession(client());
    await session.login("repartidor3@norte.demo", PASSWORD);
    expect(session.getState()).toEqual({ status: "anonymous", error: NOT_STAFF });
  });

  it("listado de repartidores: contrato real y los del seed", async () => {
    const api = client();
    await api.login("duenio@norte.demo", PASSWORD);
    const drivers = await api.listDrivers();
    const emails = drivers.map((d) => d.email);
    for (const n of [1, 2, 3, 4, 5]) expect(emails).toContain(`repartidor${n}@norte.demo`);
    expect(emails.every((e) => e.endsWith("@norte.demo"))).toBe(true); // nada de Demo Sur
  });

  it("un repartidor no puede pedir el listado (403)", async () => {
    const api = client();
    await api.login("repartidor3@norte.demo", PASSWORD);
    await expect(api.listDrivers()).rejects.toMatchObject({ status: 403 });
    expect((await api.listDrivers().catch((e) => e)) instanceof ApiError).toBe(true);
  });

  it("jornadas de hoy y el recorrido de la más reciente cumplen el contrato del panel", async () => {
    const api = client();
    await api.login("duenio@norte.demo", PASSWORD);
    const all = await api.listWorkdays();
    expect(all.length).toBeGreaterThan(0); // las de las pruebas en teléfonos y las de integración
    expect(all.every((w) => typeof w.point_count === "number")).toBe(true);
    const todays = await api.listWorkdays(today());
    expect(todays.every((w) => w.date === today())).toBe(true);
    const track = await api.workdayTrack(all[0]!.id);
    expect(track.workday.id).toBe(all[0]!.id);
  });
});
