/** Carga con escaneo (ADR-014): varios códigos por cuadro, sin repetir, contra los asignados. */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "../api/client";
import { createApp, type Scanner } from "../app";
import { classifyScan } from "../scan/session";
import { FakeBackend } from "../test/fakeBackend";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb } from "../test/helpers";
import { testPackage } from "../test/packages";
import { App } from "./App";

vi.mock("@routcontrol/ui/map", () => ({ TrackMap: () => <div data-testid="map" />, setOfflineTiles: () => {}, StopsMap: () => <div data-testid="stops-map" /> }));

/** Cámara y detector falsos: cada análisis devuelve el próximo "cuadro" de la lista. */
function fakeScanner(frames: string[][], cameraError?: Error): Scanner & { frames: string[][] } {
  const scanner = {
    frames,
    skipReadyCheck: true,
    async createDetector() {
      return { kind: "wasm" as const, detector: { detect: async () => (scanner.frames.shift() ?? []).map((rawValue) => ({ rawValue })) } };
    },
    async openCamera() {
      if (cameraError) throw cameraError;
      return { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
    },
  };
  return scanner;
}

async function open(scanner: Scanner, packages = [testPackage({ tracking_code: "AAA-1" }), testPackage({ tracking_code: "BBB-2" }), testPackage({ tracking_code: "CCC-3", status: "DELIVERED" })]) {
  const backend = new FakeBackend();
  backend.packages = packages;
  const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch, { getRetryDelayMs: 0 }), device: new FakeDevice(), scanner });
  render(<App app={app} welcomeMs={0} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "repartidor@demo.test");
  await user.type(screen.getByLabelText("Contraseña"), "secreta");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
  await user.click(await screen.findByRole("button", { name: "Paquetes" }));
  await user.click(await screen.findByRole("button", { name: "Cargar paquetes (escanear)" }));
  return { app, backend, user };
}

describe("qué hacer con cada código", () => {
  const packages = [testPackage({ tracking_code: "aaa-1" }), testPackage({ tracking_code: "IN-1", status: "IN_ROUTE" }), testPackage({ tracking_code: "OK-1", status: "DELIVERED" })];
  it.each([
    ["AAA-1", "loaded"],
    [" aaa-1 ", "loaded"],
    ["IN-1", "already_loaded"],
    ["OK-1", "resolved"],
    ["NADA", "not_assigned"],
  ])("%s → %s", (code, outcome) => {
    expect(classifyScan(code, packages, new Set()).outcome).toBe(outcome);
  });
  it("un código ya leído en esta tanda no se repite", () => {
    expect(classifyScan("AAA-1", packages, new Set(["AAA-1"])).outcome).toBe("duplicate");
  });
});

describe("pantalla de carga", () => {
  it("lee varios códigos por cuadro, no repite, y avisa los que no son suyos", async () => {
    const scanner = fakeScanner([["AAA-1", "ZZZ-9"], ["AAA-1", "BBB-2"], ["AAA-1"], ["CCC-3"]]);
    const { app, backend } = await open(scanner);
    const list = await screen.findByRole("list", { name: "Escaneados" }, { timeout: 3000 });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(4), { timeout: 3000 });
    const text = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(text.filter((t) => t?.includes("AAA-1"))).toHaveLength(1); // sin repetir
    expect(text.find((t) => t?.includes("ZZZ-9"))).toContain("No está asignado a vos");
    expect(text.find((t) => t?.includes("CCC-3"))).toContain("Ya está resuelto");
    expect(screen.getByText("2 de 2 cargados")).toBeTruthy();
    await waitFor(() => expect(backend.callsTo("/packages/load").length).toBeGreaterThan(0));
    const sent = backend.callsTo("/packages/load").flatMap((c) => (c.body as { tracking_codes: string[] }).tracking_codes);
    expect(sent.sort()).toEqual(["AAA-1", "BBB-2"]);
    app.workday.dispose();
  });

  it("sin cámara (permiso denegado): lo explica y deja ingresar el código a mano", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const { app, user } = await open(fakeScanner([], denied));
    expect(await screen.findByText(/La cámara está bloqueada/)).toBeTruthy();
    await user.type(screen.getByLabelText("Ingresar código a mano"), "bbb-2");
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    expect(within(screen.getByRole("list", { name: "Escaneados" })).getByText(/Cargado/)).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    app.workday.dispose();
  });

  it("'Listo' vuelve a la lista con los paquetes en camino", async () => {
    const { app, user } = await open(fakeScanner([["AAA-1"]]));
    await waitFor(() => expect(screen.getByText("1 de 2 cargados")).toBeTruthy(), { timeout: 3000 });
    await user.click(screen.getByRole("button", { name: "Listo" }));
    const item = within(await screen.findByRole("list", { name: "Paquetes" })).getAllByRole("button")[0]!;
    expect(item.textContent).toContain("En camino");
    app.workday.dispose();
  });
});
