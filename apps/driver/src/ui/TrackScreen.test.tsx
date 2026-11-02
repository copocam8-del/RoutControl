import type { WorkdayTrack } from "@routcontrol/domain";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "../api/client";
import { createApp } from "../app";
import { FakeBackend } from "../test/fakeBackend";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb, settle } from "../test/helpers";
import { AppContext } from "./hooks";
import { formatDistance, formatDuration } from "@routcontrol/ui";

import { TrackScreen } from "./TrackScreen";

function Tracks() {
  const [selected, setSelected] = useState<string | null>(null);
  return <TrackScreen selected={selected} onSelect={setSelected} onHome={() => {}} />;
}

// MapLibre necesita WebGL (no existe en jsdom): se reemplaza por un doble que muestra qué recibió.
vi.mock("@routcontrol/ui/map", () => ({
  TrackMap: ({ track }: { track: WorkdayTrack }) => <div data-testid="map">mapa con {track.points.features.length} puntos</div>,
}));

async function setupWithWorkday() {
  const backend = new FakeBackend();
  const device = new FakeDevice();
  const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch, { getRetryDelayMs: 0 }), device });
  await app.api.login("repartidor@demo.test", "secreta");
  await app.workday.resume();
  await app.workday.start();
  await app.sender.flush();
  backend.trackGaps = [
    { from_at: "2026-11-01T12:05:00Z", to_at: "2026-11-01T12:25:00Z", seconds: 1200, reason: "desconocido", from: [-58.4, -34.6], to: [-58.41, -34.61] },
  ];
  return { app, backend };
}

describe("Mis recorridos", () => {
  it("lista las jornadas y muestra el recorrido con su resumen y sus huecos", async () => {
    const { app } = await setupWithWorkday();
    const user = userEvent.setup();
    render(
      <AppContext.Provider value={app}>
        <Tracks />
      </AppContext.Provider>,
    );
    await user.click(await screen.findByRole("button", { name: /En curso/ }));
    expect(await screen.findByTestId("map")).toHaveProperty("textContent", "mapa con 1 puntos");
    const summary = screen.getByRole("region", { name: "Resumen del recorrido" });
    expect(summary.textContent).toContain("Distancia1,2 km");
    expect(summary.textContent).toContain("Duración");
    const gaps = screen.getByRole("region", { name: "Huecos del recorrido" });
    expect(gaps.textContent).toContain("1 tramo sin datos");
    expect(gaps.textContent).toContain("20 min sin ubicación");
    expect(screen.getByRole("heading", { name: "Mi recorrido" })).toBeTruthy();
    app.workday.dispose();
    await settle();
  });

  it("sin jornadas, lo dice", async () => {
    const backend = new FakeBackend();
    const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch), device: new FakeDevice() });
    await app.api.login("repartidor@demo.test", "secreta");
    render(
      <AppContext.Provider value={app}>
        <Tracks />
      </AppContext.Provider>,
    );
    expect(await screen.findByText("Todavía no hay jornadas registradas.")).toBeTruthy();
  });
});

function renderTrackScreen(app: Awaited<ReturnType<typeof setupWithWorkday>>["app"]) {
  render(
    <AppContext.Provider value={app}>
      <Tracks />
    </AppContext.Provider>,
  );
}

describe("Mis recorridos: si falla la carga (iPhone, 12:59: se cortó el túnel)", () => {
  it("muestra SOLO el error, sin 'Cargando…', y 'Reintentar' lo vuelve a pedir", async () => {
    const { app, backend } = await setupWithWorkday();
    const user = userEvent.setup();
    renderTrackScreen(app);
    const workdayId = [...backend.workdays.keys()][0]!;
    // Más cortes que el reintento automático: la pantalla tiene que mostrar el error.
    backend.networkFailures.set(`/workdays/${workdayId}/track`, 2);

    await user.click(await screen.findByRole("button", { name: /En curso/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Sin conexión con el servidor: no se pudo cargar el recorrido.");
    expect(screen.queryByText(/Cargando/)).toBeNull();
    expect(screen.queryByTestId("map")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("map")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Cargando/)).toBeNull();
    app.workday.dispose();
  });

  it("un corte breve (una sola falla) no llega a mostrarse: la lectura se reintenta sola", async () => {
    const { app, backend } = await setupWithWorkday();
    const user = userEvent.setup();
    renderTrackScreen(app);
    const workdayId = [...backend.workdays.keys()][0]!;
    backend.networkFailures.set(`/workdays/${workdayId}/track`, 1);
    await user.click(await screen.findByRole("button", { name: /En curso/ }));
    expect(await screen.findByTestId("map")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    app.workday.dispose();
  });

  it("un error del servidor muestra el código y también ofrece reintentar", async () => {
    const { app, backend } = await setupWithWorkday();
    const user = userEvent.setup();
    renderTrackScreen(app);
    const workdayId = [...backend.workdays.keys()][0]!;
    backend.forced.set(`/workdays/${workdayId}/track`, [500]);
    await user.click(await screen.findByRole("button", { name: /En curso/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("No se pudo cargar el recorrido (error 500).");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    app.workday.dispose();
  });

  it("si falla el listado, también: solo el error y 'Reintentar'", async () => {
    const { app, backend } = await setupWithWorkday();
    backend.networkFailures.set("/workdays/", 2);
    const user = userEvent.setup();
    renderTrackScreen(app);
    expect((await screen.findByRole("alert")).textContent).toContain("no se pudo cargar las jornadas");
    expect(screen.queryByText(/Cargando/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("button", { name: /En curso/ })).toBeTruthy();
    app.workday.dispose();
  });
});

describe("formatos", () => {
  it.each([
    [59, "1 min"],
    [1200, "20 min"],
    [3900, "1 h 05 min"],
  ])("%i s → %s", (s, text) => expect(formatDuration(s)).toBe(text));

  it.each([
    [850.4, "850 m"],
    [1234.5, "1,2 km"],
  ])("%f m → %s", (m, text) => expect(formatDistance(m)).toBe(text));
});
