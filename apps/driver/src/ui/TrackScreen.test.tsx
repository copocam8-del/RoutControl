import type { WorkdayTrack } from "@routcontrol/domain";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "../api/client";
import { createApp } from "../app";
import { FakeBackend } from "../test/fakeBackend";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb, settle } from "../test/helpers";
import { AppContext } from "./hooks";
import { formatDistance, formatDuration, TrackScreen } from "./TrackScreen";

// MapLibre necesita WebGL (no existe en jsdom): se reemplaza por un doble que muestra qué recibió.
vi.mock("./TrackMap", () => ({
  TrackMap: ({ track }: { track: WorkdayTrack }) => <div data-testid="map">mapa con {track.points.features.length} puntos</div>,
}));

async function setupWithWorkday() {
  const backend = new FakeBackend();
  const device = new FakeDevice();
  const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch), device });
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
        <TrackScreen onBack={() => {}} />
      </AppContext.Provider>,
    );
    await user.click(await screen.findByRole("button", { name: /en curso/ }));
    expect(await screen.findByTestId("map")).toHaveProperty("textContent", "mapa con 1 puntos");
    const summary = screen.getByRole("region", { name: "Resumen del recorrido" });
    expect(summary.textContent).toContain("1,2 km");
    expect(summary.textContent).toContain("1hueco");
    expect(screen.getByRole("region", { name: "Huecos del recorrido" }).textContent).toContain("20 min");
    app.workday.dispose();
    await settle();
  });

  it("sin jornadas, lo dice", async () => {
    const backend = new FakeBackend();
    const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch), device: new FakeDevice() });
    await app.api.login("repartidor@demo.test", "secreta");
    render(
      <AppContext.Provider value={app}>
        <TrackScreen onBack={() => {}} />
      </AppContext.Provider>,
    );
    expect(await screen.findByText("Todavía no hay jornadas registradas.")).toBeTruthy();
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
