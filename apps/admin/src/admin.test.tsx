import { ApiClient } from "@routcontrol/api-client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminApp } from "./adminApp";
import { App } from "./App";
import { dayLabel, shiftDate } from "./pages/Workdays";
import { parseRoute, today } from "./router";
import { NOT_STAFF } from "./session";
import { driver, FakeApi, workday } from "./test/fakeApi";

vi.mock("@routcontrol/ui/map", () => ({
  TrackMap: ({ track }: { track: { workday: { driver: { name: string } } } }) => <div data-testid="map">mapa de {track.workday.driver.name}</div>,
  PositionsMap: ({ positions }: { positions: Array<{ label: string; short?: string; stale: boolean }> }) => (
    <div data-testid="positions">{positions.map((p) => `${p.short} ${p.label}${p.stale ? " (sin señal)" : ""}`).join(", ")}</div>
  ),
}));

beforeEach(() => {
  window.location.hash = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(api = new FakeApi(), welcomeMs = 0) {
  const app = createAdminApp({ api: new ApiClient("/api/v1", api.fetch, { getRetryDelayMs: 0 }) });
  const view = render(<App app={app} welcomeMs={welcomeMs} />);
  return { api, app, view, user: userEvent.setup() };
}

async function login(user: ReturnType<typeof userEvent.setup>, email = "duenio@norte.demo") {
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Contraseña"), "demo");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
}

describe("bienvenida del panel", () => {
  it("se ve al abrir y pasa al login", async () => {
    renderPanel(new FakeApi(), 80);
    expect(screen.getByText("Panel de operaciones")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(await screen.findByLabelText("Email", {}, { timeout: 2000 })).toBeTruthy();
  });

  it("un clic la saltea", async () => {
    renderPanel(new FakeApi(), 60_000);
    await new Promise((r) => setTimeout(r, 20)); // que termine de consultar la sesión
    fireEvent.click(screen.getByRole("button", { name: /Hacé clic para continuar/ }));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
  });

  it("una sola vez por apertura", async () => {
    const { app, view } = renderPanel(new FakeApi(), 60);
    await screen.findByLabelText("Email", {}, { timeout: 2000 });
    view.unmount();
    render(<App app={app} welcomeMs={60} />);
    expect(screen.queryByText("Panel de operaciones")).toBeNull();
  });

  it("con 'reducir movimiento' no hay espera", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    renderPanel(new FakeApi(), 60_000);
    expect(await screen.findByLabelText("Email", {}, { timeout: 500 })).toBeTruthy();
  });

  it("con sesión guardada pasa directo al inicio", async () => {
    const api = new FakeApi();
    await new ApiClient("/api/v1", api.fetch).login("duenio@norte.demo", "demo"); // deja la "cookie"
    renderPanel(api, 80);
    expect(screen.getByText("Panel de operaciones")).toBeTruthy();
    expect(await screen.findByRole("navigation", { name: "Secciones" }, { timeout: 2000 })).toBeTruthy();
  });
});

describe("login del panel", () => {
  it("dos columnas: el mensaje del producto y el formulario, sin 'olvidé mi contraseña'", async () => {
    renderPanel();
    expect(await screen.findByRole("heading", { name: "Toda tu operación, en un solo lugar." })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Hola de nuevo" })).toBeTruthy();
    expect(screen.getByText("¿Sos repartidor? Usá la app en tu celular.")).toBeTruthy();
    expect(screen.queryByText(/Olvidaste/)).toBeNull();
  });

  it("'Mostrar contraseña' deja ver lo que se escribió", async () => {
    const { user } = renderPanel();
    const password = (await screen.findByLabelText("Contraseña")) as HTMLInputElement;
    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(password.type).toBe("text");
  });

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

describe("inicio", () => {
  it("saluda y resume la operación con los datos del backend", async () => {
    const api = new FakeApi();
    const day = today();
    api.workdays = [
      workday({ date: day, point_count: 10 }),
      workday({ date: day, point_count: 5, last_point_at: new Date(Date.now() - 30 * 60_000).toISOString() }), // sin señal
      workday({ date: day, point_count: 1277, status: "FINISHED", ended_at: new Date().toISOString() }),
    ];
    api.drivers = [driver("Ana (demo)", true), driver("Beto (demo)", true, true), driver("Carla (demo)", false)];
    const { user } = renderPanel(api);
    await login(user);
    expect(await screen.findByRole("heading", { level: 1, name: /^(Buen día|Buenas tardes|Buenas noches), Dueña$/ })).toBeTruthy();
    const summary = await screen.findByRole("region", { name: "Resumen de hoy" });
    expect(summary.textContent).toContain("En jornada ahora2 de 3 repartidores");
    expect(summary.textContent).toContain("Jornadas finalizadas1");
    expect(summary.textContent).toMatch(/Ubicaciones registradas1.?292/);
    expect(summary.textContent).toContain("Sin señal hace más de 10 min1");
    expect(screen.getByText(/^Actualizado \d{2}:\d{2}$/)).toBeTruthy();
    expect(api.calls).toContain(`GET /workdays/?date=${day}`);
    expect(api.calls).toContain("GET /drivers/");
  });

  it("'Dónde están ahora': la última ubicación real de cada uno, con sus iniciales y en amarillo si no hay señal", async () => {
    const api = new FakeApi();
    api.drivers = [driver("Ana (demo)", true), driver("Beto Gómez (demo)", true, true), driver("Carla (demo)", false)];
    const { user } = renderPanel(api);
    await login(user);
    expect((await screen.findByTestId("positions")).textContent).toBe("AN Ana (demo), BG Beto Gómez (demo) (sin señal)");
    const people = screen.getByRole("region", { name: "Repartidores" });
    expect(people.textContent).toContain("En jornada");
    expect(people.textContent).toContain("Sin señal");
    expect(people.textContent).toContain("Todavía no empezó");
    expect(within(people).getByRole("link", { name: "Ver todos" }).getAttribute("href")).toBe("#/repartidores");
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

describe("jornadas", () => {
  function day() {
    const d = today();
    const api = new FakeApi();
    api.workdays = [
      workday({ date: d, point_count: 412, gap_count: 1 }),
      workday({ date: d, point_count: 0, last_point_at: null }),
      workday({ date: d, status: "FINISHED", ended_at: new Date().toISOString(), gap_count: 0 }),
    ];
    window.location.hash = `#/jornadas?fecha=${d}`;
    return api;
  }

  it("la tabla con horario, duración, ubicaciones y huecos; la primera fila muestra su recorrido al costado", async () => {
    const api = day();
    const { user } = renderPanel(api);
    await login(user);
    const rows = await screen.findAllByRole("row");
    expect(rows).toHaveLength(4); // encabezado + 3
    expect(rows[1]!.textContent).toContain("412");
    expect(rows[1]!.textContent).toMatch(/\d{2}:\d{2} – ahora/);
    expect(rows[1]!.getAttribute("aria-selected")).toBe("true");
    const side = screen.getByRole("region", { name: "Recorrido de la jornada elegida" });
    expect(await within(side).findByTestId("map")).toHaveProperty("textContent", `mapa de ${api.workdays[0]!.driver.name}`);
    expect(within(side).getByRole("group", { name: "Resumen del recorrido" }).textContent).toContain("Distancia2,5 km");
  });

  it("al hacer clic en una fila, su recorrido pasa al costado", async () => {
    const api = day();
    const { user } = renderPanel(api);
    await login(user);
    const target = api.workdays[2]!;
    await user.click(await screen.findByRole("button", { name: target.driver.name }));
    const side = screen.getByRole("region", { name: "Recorrido de la jornada elegida" });
    expect(await within(side).findByTestId("map")).toHaveProperty("textContent", `mapa de ${target.driver.name}`);
    expect(within(side).getByRole("link", { name: "Ver el recorrido completo" }).getAttribute("href")).toBe(`#/jornadas/${target.id}`);
  });

  it("una jornada sin ubicaciones no muestra un mapa vacío", async () => {
    const api = day();
    const { user } = renderPanel(api);
    await login(user);
    await user.click(await screen.findByRole("button", { name: api.workdays[1]!.driver.name }));
    expect(await screen.findByText("Sin ubicaciones registradas.")).toBeTruthy();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("filtros: todas, en curso y finalizadas, con su cantidad", async () => {
    const api = day();
    const { user } = renderPanel(api);
    await login(user);
    await user.click(await screen.findByRole("button", { name: "Finalizadas · 1" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "En curso · 2" }));
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Todas · 3" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("las flechas cambian de día; mañana no se puede elegir", async () => {
    const api = day();
    const { user } = renderPanel(api);
    await login(user);
    expect((await screen.findByRole("button", { name: "Día siguiente" })).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Día anterior" }));
    expect(await screen.findByText("No hay jornadas ese día.")).toBeTruthy();
    expect(api.calls).toContain(`GET /workdays/?date=${shiftDate(today(), -1)}`);
  });

  it("nombres de los días", () => {
    const now = new Date(2026, 10, 1, 15);
    expect(dayLabel("2026-11-01", now)).toBe("Hoy, domingo 1 de noviembre");
    expect(dayLabel("2026-10-31", now)).toBe("Ayer, sábado 31 de octubre");
    expect(dayLabel("2026-10-30", now)).toBe("Viernes 30 de octubre");
    expect(shiftDate("2026-11-01", -1)).toBe("2026-10-31");
  });

  it("el recorrido completo: resumen, mapa y huecos", async () => {
    const api = new FakeApi();
    const w = workday({ date: today() });
    api.workdays = [w];
    window.location.hash = `#/jornadas/${w.id}`;
    const { user } = renderPanel(api);
    await login(user);
    expect(await screen.findByTestId("map")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Resumen del recorrido" }).textContent).toContain("2,5 km");
    expect(screen.getByRole("region", { name: "Huecos del recorrido" }).textContent).toContain("15 min");
  });
});

describe("repartidores", () => {
  it("una tarjeta por repartidor: en jornada, sin señal, sin jornada y de baja, con su acción real", async () => {
    const api = new FakeApi();
    const off = {
      ...driver("Carla (demo)", false),
      last_workday: {
        id: "0192f3a0-0000-7000-8000-0000000000e3",
        date: "2026-10-31",
        started_at: new Date(Date.now() - 86_400_000).toISOString(),
        ended_at: new Date(Date.now() - 80_000_000).toISOString(),
        status: "FINISHED" as const,
      },
    };
    const gone = { ...driver("Dani (demo)", false), status: "INACTIVE" as const };
    const ana = driver("Ana (demo)", true);
    api.drivers = [ana, driver("Beto (demo)", true, true), off, gone];
    window.location.hash = "#/repartidores";
    const { user } = renderPanel(api);
    await login(user);
    expect(await screen.findByText("4 repartidores en Demo Norte (DATOS DE DEMOSTRACIÓN)")).toBeTruthy();
    const card = (name: string) => screen.getByRole("article", { name });
    expect(card("Ana (demo)").textContent).toContain("En jornada");
    expect(within(card("Ana (demo)")).getByRole("link", { name: "Ver recorrido de hoy" }).getAttribute("href")).toBe(
      `#/jornadas/${ana.active_workday!.id}`,
    );
    expect(card("Beto (demo)").textContent).toContain("Sin señal");
    expect(card("Carla (demo)").textContent).toContain("Sin jornada");
    expect(card("Carla (demo)").textContent).toMatch(/Última jornada(Ayer|Hoy) \d{2}:\d{2}/);
    expect(within(card("Carla (demo)")).getByRole("link", { name: "Ver última jornada" })).toBeTruthy();
    expect(card("Dani (demo)").textContent).toContain("De baja");
    expect(within(card("Dani (demo)")).queryByRole("link")).toBeNull(); // nunca trabajó: sin botón que no lleva a nada
  });

  it("el buscador filtra por nombre o email", async () => {
    const api = new FakeApi();
    api.drivers = [driver("Ana (demo)", true), driver("Beto (demo)", false)];
    window.location.hash = "#/repartidores";
    const { user } = renderPanel(api);
    await login(user);
    await user.type(await screen.findByLabelText("Buscar repartidor"), "beto@");
    expect(screen.queryByRole("article", { name: "Ana (demo)" })).toBeNull();
    expect(screen.getByRole("article", { name: "Beto (demo)" })).toBeTruthy();
    await user.clear(screen.getByLabelText("Buscar repartidor"));
    await user.type(screen.getByLabelText("Buscar repartidor"), "zzz");
    expect(screen.getByText("Ningún repartidor coincide con “zzz”.")).toBeTruthy();
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
