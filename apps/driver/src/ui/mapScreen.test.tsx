/** Pestaña Mapa: entregas del día en el mapa, tarjeta de la parada, Navegar y ficha (ADR-019). */
import type { MapStop, RouteLeg } from "@routcontrol/domain";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "../api/client";
import { createApp } from "../app";
import { FakeBackend } from "../test/fakeBackend";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb } from "../test/helpers";
import { testPackage } from "../test/packages";
import { App } from "./App";

// Mapa falso: una casita (botón) por parada con su número y estado, y lo demás como texto.
vi.mock("@routcontrol/ui/map", () => ({
  TrackMap: () => <div data-testid="map" />,
  setOfflineTiles: () => {},
  StopsMap: ({
    stops,
    legs = [],
    me,
    onSelect,
    label,
    interactive = true,
  }: {
    stops: MapStop[];
    legs?: RouteLeg[];
    me?: { lat: number } | null;
    onSelect?: (id: string) => void;
    label: string;
    interactive?: boolean;
  }) => (
    <div role="region" aria-label={label} data-interactive={String(interactive)}>
      {stops.map((s) => (
        <button key={s.id} type="button" aria-label={"Casita " + s.n + " " + s.state} onClick={() => onSelect?.(s.id)}>
          {s.n}
        </button>
      ))}
      <span data-testid="legs">{legs.map((l) => (l.straight ? "recta" : "calles")).join(",")}</span>
      <span data-testid="me">{me ? "con ubicación" : "sin ubicación"}</span>
    </div>
  ),
}));

const at = (raw: string, lat: number, lng: number, extra: Parameters<typeof testPackage>[0] = {}) =>
  testPackage({ recipient_name: "Destino " + raw + " (prueba)", address: { ...testPackage().address, raw_text: raw, location: { lat, lng } }, ...extra });

async function open(startWorkday = false) {
  const backend = new FakeBackend();
  backend.packages = [
    at("Uno 100", -34.6, -58.38),
    at("Dos 200", -34.61, -58.39, { status: "DELIVERED" }),
    at("Tres 300", -34.62, -58.4, { status: "FAILED" }),
    at("Cuatro 400", -34.63, -58.41, { status: "RESCHEDULED" }),
    testPackage({ address: { ...testPackage().address, raw_text: "Sin ubicación 1", location: null } }),
  ];
  const device = new FakeDevice();
  const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch, { getRetryDelayMs: 0 }), device });
  render(<App app={app} welcomeMs={0} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "repartidor@demo.test");
  await user.type(screen.getByLabelText("Contraseña"), "secreta");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
  await screen.findByRole("button", { name: "Iniciar jornada" });
  if (startWorkday) {
    await user.click(screen.getByRole("button", { name: "Iniciar jornada" }));
    await user.click(await screen.findByRole("button", { name: "Entendido, iniciar jornada" }));
    await screen.findByRole("button", { name: "Finalizar jornada" });
  }
  await waitFor(() => expect(app.deliveries.getState().status).toBe("ready"));
  await user.click(screen.getByRole("button", { name: "Mapa" }));
  return { app, backend, device, user };
}

const houses = () =>
  within(screen.getByRole("region", { name: /^Mapa con/ }))
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

describe("pestaña Mapa", () => {
  it("una casita por domicilio con su número y estado; Pendientes / Todas", async () => {
    const { app, user } = await open();
    await screen.findByRole("region", { name: /^Mapa con/ });
    // Pendientes: lo que falta visitar (pendiente y segundo intento).
    expect(houses()).toEqual(["Casita 1 pending", "Casita 4 second"]);
    expect(screen.getByRole("button", { name: "Pendientes · 2" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Todas · 4" }));
    expect(houses()).toEqual(["Casita 1 pending", "Casita 2 delivered", "Casita 3 failed", "Casita 4 second"]);
    expect(screen.getByText("1 paquete sin ubicación")).toBeTruthy();
    // Sin jornada, no hay punto azul (la ubicación solo se usa con la jornada iniciada).
    expect(screen.getByTestId("me").textContent).toBe("sin ubicación");
    expect((screen.getByRole("button", { name: "Centrar en mi ubicación" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Tu ubicación se ve con la jornada iniciada")).toBeTruthy();
    app.workday.dispose();
  });

  it("al tocar una casita sube la tarjeta; Ver ficha abre la ficha", async () => {
    const { app, user } = await open();
    await user.click(await screen.findByRole("button", { name: "Casita 1 pending" }));
    const sheet = screen.getByRole("region", { name: "Parada 1" });
    expect(within(sheet).getByText("Uno 100")).toBeTruthy();
    expect(within(sheet).getByText("Destino Uno 100 (prueba)")).toBeTruthy();
    expect(within(sheet).getByText("Asignado")).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("region", { name: "Parada 1" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Casita 1 pending" }));
    await user.click(within(screen.getByRole("region", { name: "Parada 1" })).getByRole("button", { name: "Ver ficha" }));
    expect(await screen.findByRole("heading", { name: "Ficha de entrega" })).toBeTruthy();
    app.workday.dispose();
  });

  it("Navegar pregunta la app la primera vez, la recuerda y se cambia en Perfil", async () => {
    const { app, backend, user } = await open();
    const { lat, lng } = backend.packages[0]!.address.location!;
    await user.click(await screen.findByRole("button", { name: "Casita 1 pending" }));
    const sheet = () => screen.getByRole("region", { name: "Parada 1" });
    await user.click(within(sheet()).getByRole("button", { name: "Navegar" }));
    expect(within(sheet()).getByText("Se recuerda para la próxima. La podés cambiar en Perfil.")).toBeTruthy();
    await user.click(within(sheet()).getByRole("link", { name: "Waze" }));
    // Ya elegida: Navegar es un enlace directo a Waze.
    expect(within(sheet()).getByRole("link", { name: "Navegar" }).getAttribute("href")).toBe("https://waze.com/ul?ll=" + lat + "," + lng + "&navigate=yes");
    await user.click(screen.getByRole("button", { name: "Perfil" }));
    const setting = screen.getByRole("radiogroup", { name: "Navegar con" });
    expect((within(setting).getByLabelText("Waze") as HTMLInputElement).checked).toBe(true);
    await user.click(within(setting).getByLabelText("Google Maps"));
    await user.click(screen.getByRole("button", { name: "Mapa" }));
    await user.click(await screen.findByRole("button", { name: "Casita 1 pending" }));
    expect(within(sheet()).getByRole("link", { name: "Navegar" }).getAttribute("href")).toContain("destination=" + lat + "%2C" + lng);
    expect(app.navApp.getState().app).toBe("google");
    app.workday.dispose();
  });

  it("con la jornada: mi ubicación, la distancia en la tarjeta y la línea de la ruta armada", async () => {
    const { app, device, user } = await open(true);
    await screen.findByRole("region", { name: /^Mapa con/ });
    await waitFor(() => expect(device.watchers.size).toBeGreaterThan(0));
    act(() => {
      for (const w of [...device.watchers]) w(device.fixAt(Date.now(), -34.6, -58.385));
    });
    expect(screen.getByTestId("me").textContent).toBe("con ubicación");
    expect((screen.getByRole("button", { name: "Centrar en mi ubicación" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Casita 1 pending" }));
    expect(within(screen.getByRole("region", { name: "Parada 1" })).getByText(/Destino Uno 100 \(prueba\) · a \d+ m/)).toBeTruthy();
    expect(screen.getByTestId("legs").textContent).toBe("");
    await user.click(screen.getByRole("button", { name: "Paquetes" }));
    await user.click(await screen.findByRole("button", { name: "Armar mi ruta" }));
    await screen.findByText(/Ruta armada/);
    await user.click(screen.getByRole("button", { name: "Mapa" }));
    // El falso ordena al revés: primero el paquete sin ubicación (es la parada 1, sin casita, igual
    // que en la lista) y después "Cuatro" (segundo intento), con tramos por calles.
    await waitFor(() => expect(screen.getByTestId("legs").textContent).toMatch(/^calles(,calles)*$/));
    expect(houses()[0]).toBe("Casita 2 second");
    app.workday.dispose();
  });

  it("la ficha tiene el mapa real arriba (sin arrastre) y debajo Llamar, WhatsApp y Navegar", async () => {
    const { app, user } = await open();
    await user.click(screen.getByRole("button", { name: "Paquetes" }));
    await user.click(await screen.findByRole("button", { name: /Destino Uno 100/ }));
    const card = screen.getByRole("region", { name: "Destino" });
    const map = await within(card).findByRole("region", { name: "Mapa del domicilio: Uno 100" });
    expect(map.getAttribute("data-interactive")).toBe("false");
    const call = within(card).getByRole("link", { name: "Llamar" });
    expect(within(card).getByRole("button", { name: "Navegar" })).toBeTruthy();
    // El mapa va antes que los botones.
    expect(map.compareDocumentPosition(call) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    app.workday.dispose();
  });
});
