/** Estados de carga, vacío y error de cada pantalla de la PWA. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "../api/client";
import { createApp } from "../app";
import { FakeBackend } from "../test/fakeBackend";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb } from "../test/helpers";
import { Diagnostics } from "./Diagnostics";
import { HomeScreen } from "./HomeScreen";
import { AppContext } from "./hooks";
import { TrackScreen } from "./TrackScreen";

vi.mock("@routcontrol/ui/map", () => ({ TrackMap: () => <div data-testid="map" /> }));

async function loggedInApp() {
  const backend = new FakeBackend();
  const device = new FakeDevice();
  const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch, { getRetryDelayMs: 0 }), device });
  await app.session.login("repartidor@demo.test", "secreta");
  return { app, backend, device };
}

const withApp = (app: Awaited<ReturnType<typeof loggedInApp>>["app"], ui: React.ReactNode) =>
  render(<AppContext.Provider value={app}>{ui}</AppContext.Provider>);

describe("Inicio", () => {
  it("mientras recupera la jornada guardada muestra solo 'Recuperando…' (sin botón de iniciar)", async () => {
    const { app } = await loggedInApp(); // sin resume(): la jornada sigue "cargando"
    withApp(app, <HomeScreen />);
    expect(screen.getByText("Recuperando tu jornada…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Iniciar jornada" })).toBeNull();
  });

  it("si el GPS está denegado, el estado es un botón que abre el diagnóstico", async () => {
    const { app, device } = await loggedInApp();
    await app.workday.resume();
    const { LocationError } = await import("../device/DeviceServices");
    device.nextFix = new LocationError("permission_denied");
    await app.workday.start();
    withApp(app, <HomeScreen />);
    await userEvent.click(screen.getByRole("button", { name: /GPS detenido: falta el permiso/ }));
    expect(screen.getByRole("region", { name: "Diagnóstico" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("permitir el acceso a la ubicación");
    app.workday.dispose();
  });
});

describe("Diagnóstico", () => {
  it("sin registros muestra un estado vacío explicado", async () => {
    const { app } = await loggedInApp();
    withApp(app, <Diagnostics />);
    expect(await screen.findByText("Todavía no hay registros")).toBeTruthy();
    expect(await screen.findByText("Permitido mientras se usa la app")).toBeTruthy();
  });
});

describe("Mis recorridos", () => {
  it("una jornada sin ubicaciones muestra un estado vacío, no un mapa en blanco", async () => {
    const { app, backend } = await loggedInApp();
    const id = "0192f3a0-0000-7000-8000-0000000000ff";
    backend.workdays.set(id, {
      id,
      started_at: "2026-11-01T12:00:00.000Z",
      ended_at: "2026-11-01T12:05:00.000Z",
      status: "FINISHED",
      device_id: "0192f3a0-0000-7000-8000-0000000000fe",
      token: "t",
    });
    withApp(app, <TrackScreen onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /Finalizada/ }));
    expect(await screen.findByText("Esta jornada no tiene ubicaciones registradas.")).toBeTruthy();
    expect(screen.queryByTestId("map")).toBeNull();
  });
});
