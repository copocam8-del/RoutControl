/** Historial del domicilio e indicador de recepción en el panel (ADR-022). */
import { ApiClient } from "@routcontrol/api-client";
import { render, screen, within } from "@testing-library/react";
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

describe("domicilios", () => {
  it("la ficha del paquete muestra el indicador y lleva al historial del domicilio", async () => {
    const api = new FakeApi();
    const pkg = fakePackage({ reception: { level: "yellow", score: 0.6, computable: 5 } });
    api.packages = [pkg];
    api.addresses.set(pkg.address.id, {
      address: pkg.address,
      reception: { level: "yellow", score: 0.6, computable: 5, delivered: 3, recipient_failures: 2, last_visit_at: "2026-11-01T15:00:00Z" },
      thresholds: { green: 0.8, yellow: 0.4, min_visits: 3 },
      visits: [
        {
          id: "v1",
          started_at: "2026-11-01T15:00:00Z",
          duration_s: 120,
          outcome: "RECIPIENT_ABSENT",
          outcome_attribution: "RECIPIENT",
          is_second_attempt: true,
          voided: false,
          notes: "",
          driver: "Ana (demo)",
          package: { id: pkg.id, tracking_code: pkg.tracking_code },
          evidence: [],
        },
      ],
      packages: [{ id: pkg.id, tracking_code: pkg.tracking_code, status: "FAILED", recipient_name: "Beto (prueba)" }],
    });
    const user = await panel(api, `#/paquetes/${pkg.id}`);
    const data = await screen.findByRole("region", { name: "Datos del paquete" });
    expect(within(data).getByText("A veces no está")).toBeTruthy();
    await user.click(within(data).getByRole("link", { name: "Ver historial del domicilio" }));
    expect(window.location.hash).toBe(`#/domicilios/${pkg.address.id}`);
    const kpis = await screen.findByRole("region", { name: "Indicador de recepción" });
    expect(kpis.textContent).toContain("60 %");
    const visits = screen.getByRole("region", { name: "Visitas al domicilio" });
    expect(within(visits).getByText("Destinatario ausente")).toBeTruthy();
    expect(within(visits).getByText("Del destinatario")).toBeTruthy();
    expect(within(visits).getByText(/2\.º intento/)).toBeTruthy();
    expect(screen.getByText(/Verde desde 80 %, amarillo desde 40 %/)).toBeTruthy();
    // En la barra lateral sigue marcado "Paquetes".
    expect(within(screen.getByRole("navigation", { name: "Secciones" })).getByRole("link", { name: "Paquetes" }).getAttribute("aria-current")).toBe("page");
  });
});
