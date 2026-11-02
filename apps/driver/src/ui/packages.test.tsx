/** Paquetes en la PWA: lista, ficha, Llamar/WhatsApp/Navegar, visita con cronómetro y resultado. */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "../api/client";
import { createApp } from "../app";
import { FakeBackend } from "../test/fakeBackend";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb } from "../test/helpers";
import { testPackage } from "../test/packages";
import { App } from "./App";

vi.mock("@routcontrol/ui/map", () => ({ TrackMap: () => <div data-testid="map" />, setOfflineTiles: () => {} }));

async function loggedIn(packages = [testPackage({ recipient_name: "Ana (prueba)" }), testPackage({ recipient_name: "Beto (prueba)", recipient_phone: "" })]) {
  const backend = new FakeBackend();
  backend.packages = packages;
  const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch, { getRetryDelayMs: 0 }), device: new FakeDevice() });
  render(<App app={app} welcomeMs={0} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "repartidor@demo.test");
  await user.type(screen.getByLabelText("Contraseña"), "secreta");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
  await screen.findByRole("button", { name: "Iniciar jornada" });
  return { app, backend, user, packages };
}

async function startWorkday(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Iniciar jornada" }));
  await user.click(await screen.findByRole("button", { name: "Entendido, iniciar jornada" }));
  await screen.findByRole("button", { name: "Finalizar jornada" });
}

describe("Mis paquetes", () => {
  it("lista los asignados con filtros y búsqueda", async () => {
    const { app, user } = await loggedIn();
    await user.click(screen.getByRole("button", { name: "Paquetes" }));
    const list = await screen.findByRole("list", { name: "Paquetes" });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Pendientes · 2" }).getAttribute("aria-pressed")).toBe("true");
    await user.type(screen.getByLabelText("Buscar paquete"), "beto");
    expect(within(screen.getByRole("list", { name: "Paquetes" })).getAllByRole("button")).toHaveLength(1);
    app.workday.dispose();
  });

  it("sin paquetes asignados: lo dice", async () => {
    const { app, user } = await loggedIn([]);
    await user.click(screen.getByRole("button", { name: "Paquetes" }));
    expect(await screen.findByText("No tenés paquetes asignados.")).toBeTruthy();
    app.workday.dispose();
  });
});

describe("ficha de entrega", () => {
  it("Llamar y WhatsApp con el teléfono; Navegar ofrece Google Maps y Waze", async () => {
    const { app, user, packages } = await loggedIn();
    await user.click(screen.getByRole("button", { name: "Paquetes" }));
    await user.click(await screen.findByRole("button", { name: /Ana \(prueba\)/ }));
    expect(screen.getByRole("link", { name: "Llamar" }).getAttribute("href")).toBe("tel:1155550000");
    expect(screen.getByRole("link", { name: "WhatsApp" }).getAttribute("href")).toBe("https://wa.me/5491155550000");
    await user.click(screen.getByRole("button", { name: "Navegar" }));
    const { lat, lng } = packages[0]!.address.location!;
    expect(screen.getByRole("link", { name: "Google Maps" }).getAttribute("href")).toContain(`destination=${lat}%2C${lng}`);
    expect(screen.getByRole("link", { name: "Waze" }).getAttribute("href")).toBe(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`);
    app.workday.dispose();
  });

  it("sin teléfono: no hay Llamar ni WhatsApp (nada de botones que no hacen nada)", async () => {
    const { app, user } = await loggedIn();
    await user.click(screen.getByRole("button", { name: "Paquetes" }));
    await user.click(await screen.findByRole("button", { name: /Beto \(prueba\)/ }));
    expect(screen.queryByRole("link", { name: "Llamar" })).toBeNull();
    expect(screen.queryByRole("link", { name: "WhatsApp" })).toBeNull();
    expect(screen.getByText("Este paquete no tiene teléfono del destinatario.")).toBeTruthy();
    app.workday.dispose();
  });

  it("sin jornada no se puede iniciar la visita", async () => {
    const { app, user } = await loggedIn();
    await user.click(screen.getByRole("button", { name: "Paquetes" }));
    await user.click(await screen.findByRole("button", { name: /Ana \(prueba\)/ }));
    expect(screen.queryByRole("button", { name: "Llegué: iniciar visita" })).toBeNull();
    expect(screen.getByText("Para registrar la visita, iniciá la jornada desde Inicio.")).toBeTruthy();
    app.workday.dispose();
  });

  it("visita: cronómetro, No entregado con motivo, y el paquete queda como no entregado", async () => {
    const { app, backend, user } = await loggedIn();
    await startWorkday(user);
    await user.click(screen.getByRole("button", { name: "Paquetes" }));
    await user.click(await screen.findByRole("button", { name: /Ana \(prueba\)/ }));
    await user.click(screen.getByRole("button", { name: "Llegué: iniciar visita" }));
    const panel = await screen.findByRole("region", { name: "Visita en curso" });
    expect(within(panel).getByLabelText("Tiempo de visita").textContent).toMatch(/^0:00:0\d$/);
    const confirm = within(panel).getByRole("button", { name: "Confirmar" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true); // falta el resultado
    await user.click(within(panel).getByRole("button", { name: "No entregado" }));
    await user.click(within(panel).getByRole("radio", { name: "Nadie responde" }));
    await user.click(within(panel).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(backend.visits.size).toBe(1));
    expect([...backend.visits.values()][0]).toMatchObject({ outcome: "NO_ANSWER" });
    expect(await screen.findByRole("button", { name: "Pendientes · 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "No entregados · 1" })).toBeTruthy();
    app.workday.dispose();
  });

  it("'Otro inconveniente' pide contar qué pasó y de quién fue el problema", async () => {
    const { app, user } = await loggedIn();
    await startWorkday(user);
    await user.click(screen.getByRole("button", { name: "Paquetes" }));
    await user.click(await screen.findByRole("button", { name: /Ana \(prueba\)/ }));
    await user.click(screen.getByRole("button", { name: "Llegué: iniciar visita" }));
    const panel = await screen.findByRole("region", { name: "Visita en curso" });
    await user.click(within(panel).getByRole("button", { name: "No entregado" }));
    await user.click(within(panel).getByRole("radio", { name: "Otro inconveniente" }));
    const confirm = within(panel).getByRole("button", { name: "Confirmar" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(within(panel).getByLabelText("Contá qué pasó"), "Perro suelto");
    expect(confirm.disabled).toBe(true);
    await user.click(within(panel).getByRole("radio", { name: /De la logística/ }));
    expect(confirm.disabled).toBe(false);
    app.workday.dispose();
  });
});

describe("jornada en curso con paquetes (Jornada.dc.html)", () => {
  it("muestra el avance, las cifras y la próxima parada con su acción", async () => {
    const { app, user } = await loggedIn([testPackage({ recipient_name: "Ana (prueba)" }), testPackage({ status: "DELIVERED" })]);
    await startWorkday(user);
    expect((await screen.findByRole("progressbar", { name: "Avance de entregas" })).getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText("1 de 2 entregados")).toBeTruthy();
    const stats = screen.getByRole("region", { name: "Entregas de hoy" });
    expect(stats.textContent).toContain("1Entregados");
    expect(stats.textContent).toContain("1Pendientes");
    const next = screen.getByRole("region", { name: "Próxima parada" });
    await user.click(within(next).getByRole("button", { name: "Llegué: iniciar visita" }));
    expect(await screen.findByRole("heading", { name: "Ficha de entrega" })).toBeTruthy();
    app.workday.dispose();
  });
});
