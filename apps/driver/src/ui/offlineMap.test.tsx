/** Tarjeta "Mapa sin conexión" en Mis paquetes (ADR-018). */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "../api/client";
import { createApp } from "../app";
import { config } from "../config";
import { OfflineMap } from "../map/offlineMap";
import { FakeBackend } from "../test/fakeBackend";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb } from "../test/helpers";
import { testPackage } from "../test/packages";
import { App } from "./App";

vi.mock("@routcontrol/ui/map", () => ({ TrackMap: () => <div data-testid="map" />, setOfflineTiles: () => {}, StopsMap: () => <div data-testid="stops-map" /> }));

const mapModule = {
  downloadTiles: async (_u: string, tiles: readonly { z: number; x: number; y: number }[], put: (k: string, d: Uint8Array) => Promise<void>) => {
    for (const t of tiles) await put(`${t.z}/${t.x}/${t.y}`, new Uint8Array(1000));
    return { tileJson: { minzoom: 0, maxzoom: 15, bounds: [-58.75, -34.9, -58.2, -34.45] as [number, number, number, number] }, saved: tiles.length, bytes: tiles.length * 1000 };
  },
  preloadMapCode: async () => {},
  setOfflineTiles: () => {},
};

async function open(packages: ReturnType<typeof testPackage>[]) {
  const backend = new FakeBackend();
  backend.packages = packages;
  const db = freshDb();
  const offlineMap = new OfflineMap({ db, config, loadMap: async () => mapModule, fetchImpl: (async () => new Response("")) as typeof fetch });
  const app = createApp({ db, api: new ApiClient("/api/v1", backend.fetch, { getRetryDelayMs: 0 }), device: new FakeDevice(), offlineMap });
  render(<App app={app} welcomeMs={0} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "repartidor@demo.test");
  await user.type(screen.getByLabelText("Contraseña"), "secreta");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
  await screen.findByRole("button", { name: "Iniciar jornada" });
  await user.click(screen.getByRole("button", { name: "Paquetes" }));
  return { app, user, backend };
}

describe("mapa sin conexión en Mis paquetes", () => {
  it("guarda la zona y después dice que funciona sin señal", async () => {
    const { app, user } = await open([testPackage()]);
    const card = await screen.findByRole("region", { name: "Mapa sin conexión" });
    expect(within(card).getByText("Guardá las calles de la zona de tus paquetes para ver el mapa sin señal.")).toBeTruthy();
    await user.click(within(card).getByRole("button", { name: "Guardar el mapa de la zona" }));
    expect(await within(card).findByText(/^Guardado a las .* Funciona sin señal\.$/)).toBeTruthy();
    expect(within(card).queryByRole("button")).toBeNull();
    app.workday.dispose();
  });

  it("sin direcciones ubicadas no aparece", async () => {
    const { app } = await open([testPackage({ address: { ...testPackage().address, location: null } })]);
    await screen.findByRole("list", { name: "Paquetes" });
    expect(screen.queryByRole("region", { name: "Mapa sin conexión" })).toBeNull();
    app.workday.dispose();
  });
});
