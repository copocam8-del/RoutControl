import { ApiClient } from "@routcontrol/api-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createAdminApp } from "./adminApp";
import { App } from "./App";
import { parseRoute, today } from "./router";
import { NOT_STAFF } from "./session";
import { driver, FakeApi, workday } from "./test/fakeApi";

vi.mock("@routcontrol/ui/map", () => ({
  TrackMap: () => <div data-testid="map">mapa</div>,
  PositionsMap: ({ positions }: { positions: Array<{ label: string; stale: boolean }> }) => (
    <div data-testid="positions">{positions.map((p) => `${p.label}${p.stale ? " (sin señal)" : ""}`).join(", ")}</div>
  ),
}));

function renderPanel(api = new FakeApi()) {
  const app = createAdminApp({ api: new ApiClient("/api/v1", api.fetch, { getRetryDelayMs: 0 }) });
  render(<App app={app} />);
  return { api, user: userEvent.setup() };
}

async function login(user: ReturnType<typeof userEvent.setup>, email = "duenio@norte.demo") {
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Contraseña"), "demo");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
}

describe("login del panel", () => {
  it("un repartidor no entra: el panel es para el personal", async () => {
    const { user } = renderPanel();
    await login(user, "repartidor1@norte.demo");
    expect((await screen.findByRole("alert")).textContent).toBe(NOT_STAFF);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("el dueño entra: barra lateral, empresa marcada como demo y su rol", async () => {
    const { user } = renderPanel();
    await login(user);
    const nav = await screen.findByRole("navigation", { name: "Secciones" });
    expect(within(nav).getByRole("link", { name: "Inicio" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Datos de demostración")).toBeTruthy();
    expect(screen.getByText(/Dueño\/a · Demo Norte/)).toBeTruthy();
  });

  it("'Salir' vuelve al login", async () => {
    const { user } = renderPanel();
    await login(user);
    await user.click(await screen.findByRole("button", { name: "Salir" }));
    expect(await screen.findByRole("button", { name: "Ingresar" })).toBeTruthy();
  });
});

describe("inicio (jornadas de hoy)", () => {
  it("resume la operación con los datos del backend, y lista las jornadas", async () => {
    const api = new FakeApi();
    const day = today();
    api.workdays = [
      workday({ date: day, point_count: 10 }),
      workday({ date: day, point_count: 5, last_point_at: new Date(Date.now() - 30 * 60_000).toISOString() }), // sin señal
      workday({ date: day, point_count: 7, status: "FINISHED", ended_at: new Date().toISOString() }),
    ];
    api.drivers = [driver("Ana (demo)", true), driver("Beto (demo)", true, true), driver("Carla (demo)", false)];
    const { user } = renderPanel(api);
    await login(user);
    const summary = await screen.findByRole("region", { name: "Resumen de hoy" });
    expect(summary.textContent).toContain("Repartidores en jornada2 de 3");
    expect(summary.textContent).toContain("Jornadas finalizadas1");
    expect(summary.textContent).toContain("Ubicaciones registradas22");
    expect(summary.textContent).toContain("Sin señal hace +10 min1");
    expect(screen.getAllByRole("row")).toHaveLength(4); // encabezado + 3
    expect(api.calls).toContain(`GET /workdays/?date=${day}`);
    expect(api.calls).toContain("GET /drivers/");
  });

  it("mapa de la operación: la última ubicación real de cada uno, en amarillo si no hay señal", async () => {
    const api = new FakeApi();
    api.drivers = [driver("Ana (demo)", true), driver("Beto (demo)", true, true), driver("Carla (demo)", false)];
    const { user } = renderPanel(api);
    await login(user);
    expect((await screen.findByTestId("positions")).textContent).toBe("Ana (demo), Beto (demo) (sin señal)");
    const people = screen.getByRole("region", { name: "Repartidores" });
    expect(people.textContent).toContain("En jornada");
    expect(people.textContent).toContain("Sin señal");
    expect(people.textContent).toContain("Todavía no empezó");
  });

  it("sin nadie en jornada, el mapa explica por qué está vacío", async () => {
    const api = new FakeApi();
    api.drivers = [driver("Carla (demo)", false)];
    const { user } = renderPanel(api);
    await login(user);
    expect(await screen.findByText("Nadie en jornada con ubicación.")).toBeTruthy();
    expect(screen.queryByTestId("positions")).toBeNull();
  });

  it("no tiene acciones que todavía no existen (paquetes, en vivo)", async () => {
    const { user } = renderPanel();
    await login(user);
    await screen.findByRole("region", { name: "Resumen de hoy" });
    expect(screen.queryByText(/Asignar paquetes/)).toBeNull();
    expect(screen.queryByText(/Entregados|Pendientes/)).toBeNull();
    expect(screen.queryByText("En vivo")).toBeNull();
    expect(screen.getByText(/^Actualizado \d{2}:\d{2}$/)).toBeTruthy();
  });

  it("sin jornadas: estado vacío con un acceso real a repartidores", async () => {
    const { user } = renderPanel();
    await login(user);
    expect(await screen.findByText("Hoy todavía no empezó ninguna jornada.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Ver repartidores" }));
    await waitFor(() => expect(window.location.hash).toBe("#/repartidores"));
  });

  it("si falla la carga: solo el error y 'Reintentar'", async () => {
    const api = new FakeApi();
    api.workdays = [workday({ date: today() })];
    api.networkFailures.set("/workdays/", 2); // más que el reintento automático
    const { user } = renderPanel(api);
    await login(user);
    expect((await screen.findByRole("alert")).textContent).toContain("Sin conexión con el servidor");
    expect(screen.queryByText(/Cargando/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("region", { name: "Resumen de hoy" })).toBeTruthy();
  });
});

describe("jornadas y recorrido", () => {
  it("una fila abre el recorrido con su resumen, el mapa y los huecos", async () => {
    const api = new FakeApi();
    const w = workday({ date: today() });
    api.workdays = [w];
    const { user } = renderPanel(api);
    await login(user);
    await user.click(await screen.findByRole("link", { name: w.driver.name }));
    expect(await screen.findByTestId("map")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Resumen del recorrido" }).textContent).toContain("2,5 km");
    expect(screen.getByRole("region", { name: "Huecos del recorrido" }).textContent).toContain("15 min");
  });

  it("una jornada sin ubicaciones no muestra un mapa vacío", async () => {
    const api = new FakeApi();
    const w = workday({ point_count: 0, last_point_at: null });
    api.workdays = [w];
    window.location.hash = `#/jornadas/${w.id}`;
    const { user } = renderPanel(api);
    await login(user);
    expect(await screen.findByText("Esta jornada no tiene ubicaciones registradas.")).toBeTruthy();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("el calendario filtra por día", async () => {
    const api = new FakeApi();
    api.workdays = [workday({ date: "2026-10-30" })];
    window.location.hash = "#/jornadas?fecha=2026-10-29";
    const { user } = renderPanel(api);
    await login(user);
    expect(await screen.findByText("No hay jornadas ese día.")).toBeTruthy();
    window.location.hash = "#/jornadas?fecha=2026-10-30";
    expect(await screen.findByRole("link", { name: api.workdays[0]!.driver.name })).toBeTruthy();
    expect(api.calls).toContain("GET /workdays/?date=2026-10-30");
  });
});

describe("repartidores", () => {
  it("muestra en jornada, sin señal, sin jornada y de baja, con enlaces a las jornadas", async () => {
    const api = new FakeApi();
    const base = { employee_code: "", vehicle_type: "", status: "ACTIVE" as const, membership_status: "ACTIVE" as const, last_workday: null };
    const started = new Date(Date.now() - 3600_000).toISOString();
    api.drivers = [
      { ...base, id: "0192f3a0-0000-7000-8000-0000000000d1", name: "Ana (demo)", email: "ana@norte.demo", active_workday: { id: "0192f3a0-0000-7000-8000-0000000000e1", started_at: started, last_point_at: new Date().toISOString(), last_location: null } },
      { ...base, id: "0192f3a0-0000-7000-8000-0000000000d2", name: "Beto (demo)", email: "beto@norte.demo", active_workday: { id: "0192f3a0-0000-7000-8000-0000000000e2", started_at: started, last_point_at: null, last_location: null } },
      { ...base, id: "0192f3a0-0000-7000-8000-0000000000d3", name: "Carla (demo)", email: "carla@norte.demo", active_workday: null },
      { ...base, id: "0192f3a0-0000-7000-8000-0000000000d4", name: "Dani (demo)", email: "dani@norte.demo", active_workday: null, status: "INACTIVE" },
    ];
    window.location.hash = "#/repartidores";
    const { user } = renderPanel(api);
    await login(user);
    const rows = await screen.findAllByRole("row");
    const text = rows.slice(1).map((r) => r.textContent);
    expect(text[0]).toContain("En jornada");
    expect(text[1]).toContain("En jornada · sin señal");
    expect(text[2]).toContain("Sin jornada");
    expect(text[3]).toContain("De baja");
    expect(within(rows[1]!).getByRole("link").getAttribute("href")).toBe("#/jornadas/0192f3a0-0000-7000-8000-0000000000e1");
  });

  it("sin repartidores: estado vacío", async () => {
    window.location.hash = "#/repartidores";
    const { user } = renderPanel();
    await login(user);
    expect(await screen.findByText("Todavía no hay repartidores en esta empresa.")).toBeTruthy();
  });
});

describe("rutas", () => {
  it.each([
    ["", { name: "dashboard" }],
    ["#/repartidores", { name: "drivers" }],
    ["#/jornadas?fecha=2026-10-30", { name: "workdays", date: "2026-10-30" }],
    ["#/jornadas/0192f3a0-0000-7000-8000-000000000001", { name: "workday", id: "0192f3a0-0000-7000-8000-000000000001" }],
    ["#/cualquier-cosa", { name: "dashboard" }],
  ])("%s", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it("una fecha inválida vuelve a hoy", () => {
    expect(parseRoute("#/jornadas?fecha=hackeo")).toEqual({ name: "workdays", date: today() });
  });
});
