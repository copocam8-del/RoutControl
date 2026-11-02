/** Diseño aprobado (docs/diseno/): bienvenida, barra inferior y solo funciones que existen. */
import type { WorkdayTrack } from "@routcontrol/domain";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClient } from "../api/client";
import { createApp } from "../app";
import { FakeBackend } from "../test/fakeBackend";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb } from "../test/helpers";
import { App } from "./App";

vi.mock("@routcontrol/ui/map", () => ({
  TrackMap: ({ track, live }: { track: WorkdayTrack; live: boolean }) => (
    <div data-testid="map">
      mapa de {track.workday.id} {live ? "en vivo" : ""}
    </div>
  ),
  setOfflineTiles: () => {}, StopsMap: () => <div data-testid="stops-map" />,
}));

function setup(opts: { loggedIn?: boolean } = {}) {
  const backend = new FakeBackend();
  const device = new FakeDevice();
  const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch, { getRetryDelayMs: 0 }), device });
  return { backend, device, app, opts };
}

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bienvenida", () => {
  it("se ve al abrir la app y después pasa al login", async () => {
    const { app } = setup();
    render(<App app={app} welcomeMs={80} />);
    expect(screen.getByRole("button", { name: /Tocá para continuar/ })).toBeTruthy();
    expect(screen.getByText("Tus repartos, bajo control")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(await screen.findByLabelText("Email", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText("Tus repartos, bajo control")).toBeNull();
  });

  it("con sesión guardada pasa directo al inicio", async () => {
    const { app, backend } = setup();
    await new ApiClient("/api/v1", backend.fetch).login("repartidor@demo.test", "secreta"); // deja la "cookie"
    render(<App app={app} welcomeMs={80} />);
    expect(screen.getByText("Tus repartos, bajo control")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Iniciar jornada" }, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("tocar la pantalla la saltea", async () => {
    const { app } = setup();
    render(<App app={app} welcomeMs={60_000} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20)); // que termine de recuperar la sesión
    });
    fireEvent.click(screen.getByRole("button", { name: /Tocá para continuar/ }));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
  });

  it("una sola vez por apertura de la app (no vuelve al salir de la sesión ni al re-montar)", async () => {
    const { app } = setup();
    const first = render(<App app={app} welcomeMs={60} />);
    await screen.findByLabelText("Email", {}, { timeout: 2000 });
    first.unmount();
    render(<App app={app} welcomeMs={60} />);
    expect(screen.queryByText("Tus repartos, bajo control")).toBeNull();
  });

  it("con 'reducir movimiento' no hay espera: queda solo lo que tarda en recuperar la sesión", async () => {
    mockReducedMotion(true);
    const { app } = setup();
    render(<App app={app} welcomeMs={60_000} />);
    expect(await screen.findByLabelText("Email", {}, { timeout: 500 })).toBeTruthy();
  });
});

async function loggedIn() {
  const env = setup();
  render(<App app={env.app} welcomeMs={0} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "repartidor@demo.test");
  await user.type(screen.getByLabelText("Contraseña"), "secreta");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
  await screen.findByRole("button", { name: "Iniciar jornada" });
  return { ...env, user };
}

describe("solo lo que existe en la etapa 0", () => {
  it("la barra inferior tiene Inicio, Paquetes, Mapa, Recorridos y Perfil", async () => {
    const { app } = await loggedIn();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    const names = [...nav.querySelectorAll("button")].map((b) => b.textContent);
    expect(names).toEqual(["Inicio", "Paquetes", "Mapa", "Recorridos", "Perfil"]);
    expect(screen.getByRole("button", { name: "Inicio" }).getAttribute("aria-current")).toBe("page");
    app.workday.dispose();
  });

  it.each(["Notificaciones", "Llamar", "WhatsApp", "Navegar", /Olvidaste/, /paquetes asignados/, /Próxima parada/, /Mapa de tu zona/])(
    "sin paquetes asignados no aparece '%s' (y las notificaciones todavía no existen)",
    async (text) => {
      const { app, user } = await loggedIn();
      await user.click(screen.getByRole("button", { name: "Iniciar jornada" }));
      await user.click(await screen.findByRole("button", { name: "Entendido, iniciar jornada" }));
      await screen.findByRole("button", { name: "Finalizar jornada" });
      expect(screen.queryByText(text)).toBeNull();
      expect(screen.queryByRole("button", { name: text })).toBeNull();
      app.workday.dispose();
    },
  );

  it("el login no tiene '¿Olvidaste tu contraseña?' (la recuperación es de la etapa 1)", async () => {
    const { app } = setup();
    render(<App app={app} welcomeMs={0} />);
    await screen.findByLabelText("Email");
    expect(screen.queryByText(/Olvidaste/)).toBeNull();
  });
});

describe("jornada en curso", () => {
  it("muestra el cronómetro, 'Desde las', el estado real y 'Ver mi recorrido' abre el de hoy", async () => {
    const { app, backend, user } = await loggedIn();
    await user.click(screen.getByRole("button", { name: "Iniciar jornada" }));
    await user.click(await screen.findByRole("button", { name: "Entendido, iniciar jornada" }));
    await screen.findByText("Registrando recorrido");
    expect(screen.getByLabelText("Tiempo de jornada").textContent).toMatch(/^0:00:0\d$/);
    expect(screen.getByText("Desde las")).toBeTruthy();
    const stats = screen.getByRole("region", { name: "Estado del registro" });
    expect(stats.textContent).toContain("± 8 m"); // la precisión de la ubicación del evento
    await app.sender.flush();

    await user.click(screen.getByRole("button", { name: "Ver mi recorrido" }));
    const id = [...backend.workdays.keys()][0]!;
    expect((await screen.findByTestId("map")).textContent).toContain(`mapa de ${id} en vivo`);
    expect(screen.queryByRole("navigation", { name: "Navegación principal" })).toBeNull(); // como la maqueta
    await user.click(screen.getByRole("button", { name: "Volver al inicio" }));
    expect(await screen.findByRole("button", { name: "Finalizar jornada" })).toBeTruthy();
    app.workday.dispose();
  });

  it("finalizar vuelve al inicio sin jornada", async () => {
    const { app, user } = await loggedIn();
    await user.click(screen.getByRole("button", { name: "Iniciar jornada" }));
    await user.click(await screen.findByRole("button", { name: "Entendido, iniciar jornada" }));
    await user.click(await screen.findByRole("button", { name: "Finalizar jornada" }));
    await waitFor(() => expect(screen.getByText("Tu jornada todavía no empezó")).toBeTruthy());
    app.workday.dispose();
  });
});

describe("perfil", () => {
  it("muestra el usuario, la empresa y el rol, y deja salir sin jornada", async () => {
    const { app, user } = await loggedIn();
    await user.click(screen.getByRole("button", { name: "Perfil" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBeTruthy();
    expect(screen.getByText("Repartidor/a")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Diagnóstico/ }));
    expect(screen.getByRole("region", { name: "Diagnóstico" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Salir" }));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    app.workday.dispose();
  });
});

describe("apariencia (Perfil)", () => {
  it("Oscuro por defecto; Claro se aplica enseguida y queda guardado para ese usuario", async () => {
    const { applyTheme, getThemePreference } = await import("@routcontrol/ui");
    localStorage.clear();
    applyTheme("dark");
    const { app, user } = await loggedIn();
    await user.click(screen.getByRole("button", { name: "Perfil" }));
    const group = screen.getByRole("radiogroup", { name: "Apariencia" });
    expect((screen.getByRole("radio", { name: /Oscuro/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("radio", { name: /Claro/ }));
    expect(document.documentElement.dataset.theme).toBe("light");
    const session = app.session.getState();
    const id = session.status === "authenticated" ? session.session.user.id : "";
    expect(getThemePreference(id)).toBe("light");
    expect(group).toBeTruthy();
    applyTheme("dark");
    app.workday.dispose();
  });
});
