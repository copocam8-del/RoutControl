/** Estados de carga, vacío y error de cada pantalla de la PWA. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

function Tracks() {
  const [selected, setSelected] = useState<string | null>(null);
  return <TrackScreen selected={selected} onSelect={setSelected} onHome={() => {}} />;
}

const withApp = (app: Awaited<ReturnType<typeof loggedInApp>>["app"], ui: React.ReactNode) =>
  render(<AppContext.Provider value={app}>{ui}</AppContext.Provider>);

describe("Inicio", () => {
  it("mientras recupera la jornada guardada muestra solo 'Recuperando…' (sin botón de iniciar)", async () => {
    const { app } = await loggedInApp(); // sin resume(): la jornada sigue "cargando"
    withApp(app, <HomeScreen onShowTrack={() => {}} />);
    expect(screen.getByText("Recuperando tu jornada…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Iniciar jornada" })).toBeNull();
  });

  it("si el permiso está bloqueado desde antes, 'Antes de salir' lo dice y al tocarlo muestra los pasos", async () => {
    const { app, device } = await loggedInApp();
    device.permissionState = "denied";
    await app.workday.resume();
    withApp(app, <HomeScreen onShowTrack={() => {}} />);
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: /Ubicación bloqueada/ }));
    expect(screen.getByRole("alert").textContent).toContain("La ubicación está bloqueada para esta app");
    app.workday.dispose();
  });

  it("'Antes de salir' muestra solo datos reales: sin batería si el navegador no la informa", async () => {
    const { app, device } = await loggedInApp();
    device.batteryLevel = null;
    await app.workday.resume();
    withApp(app, <HomeScreen onShowTrack={() => {}} />);
    expect(await screen.findByText("Ubicación permitida")).toBeTruthy();
    expect(screen.getByText("Todo enviado")).toBeTruthy();
    expect(screen.queryByText(/Batería/)).toBeNull();
    app.workday.dispose();
  });

  it("con la batería informada, la muestra", async () => {
    const { app, device } = await loggedInApp();
    device.batteryLevel = 0.34;
    await app.workday.resume();
    withApp(app, <HomeScreen onShowTrack={() => {}} />);
    expect(await screen.findByText("Batería al 34%")).toBeTruthy();
    app.workday.dispose();
  });
});

describe("Diagnóstico", () => {
  it("muestra el error exacto del mapa (mensaje, recurso y URL) para mandar la captura", async () => {
    const { clearMapErrors, recordMapError } = await import("@routcontrol/ui");
    clearMapErrors();
    const { app } = await loggedInApp();
    withApp(app, <Diagnostics />);
    expect(await screen.findByText("Sin errores del mapa.")).toBeTruthy();
    recordMapError({
      at: Date.now(),
      kind: "failed",
      resource: "worker de MapLibre",
      message: "SyntaxError: Unexpected token '<'",
      url: "https://x.trycloudflare.com/assets/maplibre-gl-worker-abc.mjs",
      status: null,
    });
    const section = await screen.findByRole("region", { name: "Errores del mapa" });
    expect(section.textContent).toContain("No se pudo cargar · worker de MapLibre");
    expect(section.textContent).toContain("SyntaxError: Unexpected token '<'");
    expect(section.textContent).toContain("https://x.trycloudflare.com/assets/maplibre-gl-worker-abc.mjs");
    await userEvent.click(screen.getByRole("button", { name: "Borrar errores del mapa" }));
    expect(await screen.findByText("Sin errores del mapa.")).toBeTruthy();
  });

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
    withApp(app, <Tracks />);
    await userEvent.click(await screen.findByRole("button", { name: /Finalizada/ }));
    expect(await screen.findByText("Esta jornada no tiene ubicaciones registradas.")).toBeTruthy();
    expect(screen.queryByTestId("map")).toBeNull();
  });
});
