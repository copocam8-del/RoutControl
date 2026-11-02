/** Informes por repartidor y por empresa, con exportación (ADR-024). */
import { ApiClient } from "@routcontrol/api-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminApp } from "./adminApp";
import { App } from "./App";
import { FakeApi } from "./test/fakeApi";

vi.mock("@routcontrol/ui/map", () => ({ TrackMap: () => <div />, PositionsMap: () => <div /> }));

beforeEach(() => {
  window.location.hash = "";
});

const metrics = (o: Record<string, unknown>) => ({
  workdays: 1, hours: 8.5, distance_km: 42.3, events_only_workdays: 0, no_signal_minutes: 12, visits: 20, delivered: 17, failed: 3,
  failed_recipient: 2, failed_logistic: 1, second_attempts: 1, delivery_rate: 0.85, avg_visit_minutes: 3.2, ...o,
});

async function panel(api: FakeApi) {
  render(<App app={createAdminApp({ api: new ApiClient("/api/v1", api.fetch, { getRetryDelayMs: 0 }), live: { WebSocketImpl: null } })} welcomeMs={0} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "duenio@norte.demo");
  await user.type(screen.getByLabelText("Contraseña"), "demo");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
  return user;
}

describe("informes", () => {
  it("por repartidor y total de la empresa; se cambia el período y se exporta", async () => {
    const api = new FakeApi();
    api.reportDrivers = [
      { driver: { id: "0192f3a0-0000-7000-8000-000000000a01", name: "Ana (demo)" }, ...metrics({}) },
      { driver: { id: "0192f3a0-0000-7000-8000-000000000a02", name: "Beto (demo)" }, ...metrics({ delivered: 8, failed: 2, visits: 10, events_only_workdays: 1 }) },
    ];
    const user = await panel(api);
    await user.click(await screen.findByRole("link", { name: "Informes" }));
    const table = await screen.findByRole("region", { name: "Por repartidor" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]!.textContent).toContain("Ana (demo)");
    expect(rows[1]!.textContent).toContain("85 %");
    expect(rows.at(-1)!.textContent).toContain("Total de la empresa");
    expect(screen.getByRole("region", { name: "Resumen del período" }).textContent).toContain("25 de 30 visitas cerradas");
    expect(screen.getByText(/1 jornada es de la app web/)).toBeTruthy();
    expect(api.reportQueries.at(-1)).toContain("period=week");

    await user.click(screen.getByRole("link", { name: "Mes" }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/informes\?periodo=mes&fecha=/));
    await waitFor(() => expect(api.reportQueries.at(-1)).toContain("period=month"));
    expect(await screen.findByText("Noviembre de 2026", { selector: ".day-nav__label" })).toBeTruthy();

    URL.createObjectURL = vi.fn(() => "blob:informe");
    URL.revokeObjectURL = vi.fn();
    await user.click(screen.getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(api.reportQueries.some((q) => q.includes("formato=xlsx") && q.includes("period=month"))).toBe(true));
  });

  it("un rango con fechas, y sin actividad lo dice", async () => {
    const api = new FakeApi();
    window.location.hash = "#/informes?periodo=rango&fecha=2026-10-01&hasta=2026-10-15";
    await panel(api);
    expect(await screen.findByText("Sin actividad en este período.")).toBeTruthy();
    expect(api.reportQueries.at(-1)).toContain("from=2026-10-01");
    expect(api.reportQueries.at(-1)).toContain("to=2026-10-15");
    const range = screen.getByRole("form", { name: "Rango de fechas" });
    expect((within(range).getByLabelText("Desde") as HTMLInputElement).value).toBe("2026-10-01");
  });
});
