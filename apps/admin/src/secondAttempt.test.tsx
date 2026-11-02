/** Segundo intento con sugerencia de desvío en la ficha del paquete (ADR-023). */
import { ApiClient } from "@routcontrol/api-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminApp } from "./adminApp";
import { App } from "./App";
import { FakeApi, fakePackage } from "./test/fakeApi";

vi.mock("@routcontrol/ui/map", () => ({ TrackMap: () => <div />, PositionsMap: () => <div /> }));

beforeEach(() => {
  window.location.hash = "";
});

async function panel(api: FakeApi, hash: string) {
  window.location.hash = hash;
  render(<App app={createAdminApp({ api: new ApiClient("/api/v1", api.fetch, { getRetryDelayMs: 0 }), live: { WebSocketImpl: null } })} welcomeMs={0} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "duenio@norte.demo");
  await user.type(screen.getByLabelText("Contraseña"), "demo");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
  return user;
}

describe("segundo intento", () => {
  it("se pide con la franja del destinatario, muestra la sugerencia y se acepta", async () => {
    const api = new FakeApi();
    const pkg = fakePackage({ status: "FAILED" });
    api.packages = [pkg];
    const user = await panel(api, `#/paquetes/${pkg.id}`);
    const card = await screen.findByRole("region", { name: "Segundo intento" });
    const form = within(card).getByRole("form", { name: "Pedir segundo intento" });
    await user.type(within(form).getByLabelText("El destinatario está desde"), "14:00");
    await user.type(within(form).getByLabelText("Hasta"), "18:00");
    await user.type(within(form).getByLabelText("Nota para el repartidor"), "Tocar timbre 3");
    await user.click(within(form).getByRole("button", { name: "Pedir segundo intento" }));

    expect(await within(card).findByText("Sugerencia: Insertarlo en la ruta de hoy")).toBeTruthy();
    expect(card.textContent).toContain("Insertarlo después de la parada 2: suma unos 6 min de recorrido.");
    expect(card.textContent).toContain("Está a 1,8 km del repartidor · 5 paradas pendientes · El destinatario está de 14:00 a 18:00 · Tocar timbre 3");
    const sent = api.secondAttempts[0]!;
    expect(new Date(String(sent.window_start)).getHours()).toBe(14);
    expect(sent.note).toBe("Tocar timbre 3");

    // Se puede elegir otra opción que la sugerida.
    expect(within(card).getByRole("button", { name: "Al final de la ruta de hoy" })).toBeTruthy();
    await user.click(within(card).getByRole("button", { name: "Aceptar: Insertarlo en la ruta de hoy" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Segundo intento" })).getByRole("list", { name: "Pedidos anteriores" }).textContent).toContain("Aceptado: Insertarlo en la ruta de hoy · de 14:00 a 18:00"));
    expect(api.packages[0]!.status).toBe("ASSIGNED");
  });

  it("lejos de la ruta: sugiere mañana, y se puede descartar", async () => {
    const api = new FakeApi();
    api.nextSuggestion = { suggestion: "NEXT_DAY", suggestion_reason: "Queda lejos de la ruta de hoy (unos 32 min de desvío): mejor mañana.", distance_m: 11000, detour_s: 1900, pending_count: 3, insert_position: 1 };
    const pkg = fakePackage({ status: "FAILED" });
    api.packages = [pkg];
    const user = await panel(api, `#/paquetes/${pkg.id}`);
    const card = await screen.findByRole("region", { name: "Segundo intento" });
    await user.click(within(card).getByRole("button", { name: "Pedir segundo intento" }));
    expect(await within(card).findByText("Sugerencia: Mañana")).toBeTruthy();
    await user.click(within(card).getByRole("button", { name: "Descartar" }));
    expect(await within(card).findByText(/Descartado/)).toBeTruthy();
    expect(api.packages[0]!.status).toBe("FAILED");
  });

  it("un paquete entregado no ofrece segundo intento", async () => {
    const api = new FakeApi();
    const pkg = fakePackage({ status: "DELIVERED" });
    api.packages = [pkg];
    await panel(api, `#/paquetes/${pkg.id}`);
    await screen.findByRole("region", { name: "Datos del paquete" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Segundo intento" })).toBeNull());
  });
});
