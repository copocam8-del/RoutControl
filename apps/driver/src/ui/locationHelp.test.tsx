/** Inicio de jornada y permiso de ubicación, desde la pantalla. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "../api/client";
import { createApp } from "../app";
import { LocationError } from "../device/DeviceServices";
import { FakeBackend } from "../test/fakeBackend";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb, settle } from "../test/helpers";
import { HomeScreen } from "./HomeScreen";
import { AppContext } from "./hooks";

vi.mock("@routcontrol/ui/map", () => ({ TrackMap: () => <div data-testid="map" /> }));

async function home(opts: { platform?: FakeDevice["platform"]; standalone?: boolean; consent?: boolean; denied?: boolean } = {}) {
  const backend = new FakeBackend();
  const device = new FakeDevice();
  device.platform = opts.platform ?? "android";
  device.standalone = opts.standalone ?? true;
  if (opts.denied) {
    device.nextFix = new LocationError("permission_denied");
    device.permissionState = "denied";
  }
  const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch, { getRetryDelayMs: 0 }), device });
  await app.session.login("repartidor@demo.test", "secreta");
  if (opts.consent !== false) await app.db.meta.put({ key: "consent-accepted-v1", value: "ya" });
  await app.workday.resume();
  render(
    <AppContext.Provider value={app}>
      <HomeScreen onShowTrack={() => {}} />
    </AppContext.Provider>,
  );
  // Espera a que se haya leído el aviso aceptado y esté el botón.
  const button = await screen.findByRole("button", { name: "Iniciar jornada" });
  await settle();
  return { app, backend, device, button, user: userEvent.setup() };
}

describe("pedido del permiso dentro del toque", () => {
  it("con el aviso ya aceptado: el toque en 'Iniciar jornada' pide la ubicación en ese mismo momento", async () => {
    const { app, device, button } = await home();
    fireEvent.click(button);
    expect(device.currentCalls).toBe(1); // sincrónico, dentro del evento del toque
    expect(await screen.findByRole("button", { name: "Finalizar jornada" })).toBeTruthy();
    app.workday.dispose();
  });

  it("la primera vez: el toque en 'Entendido, iniciar jornada' del aviso es el que pide la ubicación", async () => {
    const { app, device, button } = await home({ consent: false });
    fireEvent.click(button);
    expect(device.currentCalls).toBe(0); // primero el aviso (§5.4)
    const accept = await screen.findByRole("button", { name: "Entendido, iniciar jornada" });
    fireEvent.click(accept);
    expect(device.currentCalls).toBe(1);
    expect(await screen.findByRole("button", { name: "Finalizar jornada" })).toBeTruthy();
    await waitFor(async () => expect((await app.db.meta.get("consent-accepted-v1"))?.value).toBeTruthy());
    app.workday.dispose();
  });
});

describe("permiso bloqueado", () => {
  it("iPhone: no inicia y muestra los pasos de Ajustes del iPhone", async () => {
    const { app, backend, button, user } = await home({ platform: "ios", denied: true });
    await user.click(button);
    const help = await screen.findByRole("alert");
    expect(help.textContent).toContain("La ubicación está bloqueada para esta app");
    expect(help.textContent).toContain("No se puede iniciar la jornada sin ubicación");
    const steps = within(help).getByRole("list", { name: "Pasos en iPhone" });
    expect(steps.textContent).toContain("Privacidad y seguridad › Localización");
    expect(steps.textContent).toContain("Sitios web de Safari");
    expect(steps.textContent).toContain("borrá la app de la pantalla de inicio"); // instalada
    expect(within(help).queryByRole("list", { name: "Pasos en Android" })).toBeNull();
    expect(backend.callsTo("/workdays/start")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Finalizar jornada" })).toBeNull();
    app.workday.dispose();
  });

  it("iPhone en Safari (sin instalar): el último paso es la configuración del sitio", async () => {
    const { app, button, user } = await home({ platform: "ios", standalone: false, denied: true });
    await user.click(button);
    const steps = await screen.findByRole("list", { name: "Pasos en iPhone" });
    expect(steps.textContent).toContain("Configuración del sitio web › Ubicación");
    app.workday.dispose();
  });

  it("Android: muestra los pasos de Android, no los del iPhone", async () => {
    const { app, button, user } = await home({ platform: "android", denied: true });
    await user.click(button);
    const help = await screen.findByRole("alert");
    const steps = within(help).getByRole("list", { name: "Pasos en Android" });
    expect(steps.textContent).toContain("Configuración de sitios › Ubicación");
    expect(steps.textContent).toContain("Apps › Chrome › Permisos › Ubicación");
    expect(within(help).queryByRole("list", { name: "Pasos en iPhone" })).toBeNull();
    app.workday.dispose();
  });

  it("otro dispositivo: muestra las dos guías", async () => {
    const { app, button, user } = await home({ platform: "other", denied: true });
    await user.click(button);
    const help = await screen.findByRole("alert");
    expect(within(help).getByRole("list", { name: "Pasos en iPhone" })).toBeTruthy();
    expect(within(help).getByRole("list", { name: "Pasos en Android" })).toBeTruthy();
    app.workday.dispose();
  });

  it("'Ya lo habilité' vuelve a pedir la ubicación en ese toque y, si ahora hay permiso, inicia", async () => {
    const { app, device, button, user } = await home({ denied: true });
    await user.click(button);
    const retry = await screen.findByRole("button", { name: "Ya lo habilité, iniciar jornada" });
    device.nextFix = null;
    device.permissionState = "while_in_use";
    fireEvent.click(retry);
    expect(device.currentCalls).toBe(2);
    expect(await screen.findByRole("button", { name: "Finalizar jornada" })).toBeTruthy();
    expect(screen.queryByText("La ubicación está bloqueada para esta app")).toBeNull();
    app.workday.dispose();
  });

  it("con la jornada en curso: avisa que no se registra el recorrido, sin botón de iniciar", async () => {
    const { app, device, button, user } = await home();
    await user.click(button);
    await screen.findByText("Registrando recorrido");
    device.emitWatchError(new LocationError("permission_denied"));
    const help = await screen.findByRole("alert");
    expect(help.textContent).toContain("La jornada sigue abierta, pero no se está registrando tu recorrido");
    expect(within(help).queryByRole("button")).toBeNull();
    app.workday.dispose();
  });
});
