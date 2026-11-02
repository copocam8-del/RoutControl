/** Panel: paquetes (alta, importación, asignación), entregas e incidencias con fotos (ADR-016). */
import { ApiClient } from "@routcontrol/api-client";
import type { DeliveryRecord, Incident } from "@routcontrol/domain";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminApp } from "./adminApp";
import { App } from "./App";
import { driver, FakeApi, fakePackage } from "./test/fakeApi";

vi.mock("@routcontrol/ui/map", () => ({ TrackMap: () => <div />, PositionsMap: () => <div /> }));

beforeEach(() => {
  window.location.hash = "";
});

async function panel(api: FakeApi, hash: string) {
  window.location.hash = hash;
  const app = createAdminApp({ api: new ApiClient("/api/v1", api.fetch, { getRetryDelayMs: 0 }) });
  render(<App app={app} welcomeMs={0} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "duenio@norte.demo");
  await user.type(screen.getByLabelText("Contraseña"), "demo");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
  return user;
}

describe("paquetes", () => {
  it("la barra lateral tiene Paquetes y Entregas", async () => {
    const api = new FakeApi();
    await panel(api, "#/paquetes");
    const nav = await screen.findByRole("navigation", { name: "Secciones" });
    expect(within(nav).getByRole("link", { name: "Paquetes" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Entregas" })).toBeTruthy();
  });

  it("sin paquetes: ofrece importar", async () => {
    await panel(new FakeApi(), "#/paquetes");
    expect(await screen.findByText("Todavía no hay paquetes.")).toBeTruthy();
  });

  it("filtra por estado y asigna varios a un repartidor", async () => {
    const api = new FakeApi();
    api.drivers = [driver("Ana (demo)", false)];
    api.packages = [fakePackage(), fakePackage(), fakePackage({ status: "DELIVERED" })];
    const user = await panel(api, "#/paquetes");
    await screen.findByRole("region", { name: "Lista de paquetes" });
    expect(screen.getByRole("button", { name: "Sin asignar · 2" })).toBeTruthy();
    // El entregado no se puede seleccionar.
    expect((screen.getByRole("checkbox", { name: `Seleccionar ${api.packages[2]!.tracking_code}` }) as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar todos los asignables" }));
    expect(screen.getByText("2 seleccionados")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Repartidor"), "Ana (demo)");
    await user.click(screen.getByRole("button", { name: "Asignar" }));
    expect(await screen.findByText("2 asignados a Ana (demo).")).toBeTruthy();
    expect(api.bulkAssigned[0]!.ids).toHaveLength(2);
    expect(await screen.findByRole("button", { name: "Asignados · 2" })).toBeTruthy();
  });

  it("alta manual: crea el paquete y abre su ficha; un código repetido muestra el motivo", async () => {
    const api = new FakeApi();
    api.packages = [fakePackage({ tracking_code: "YA-EXISTE" })];
    const user = await panel(api, "#/paquetes");
    await user.click(await screen.findByRole("button", { name: "Nuevo paquete" }));
    const form = screen.getByRole("form", { name: "Nuevo paquete" });
    await user.type(within(form).getByLabelText("Código de seguimiento"), "YA-EXISTE");
    await user.type(within(form).getByLabelText("Dirección"), "Mitre 100");
    await user.click(within(form).getByRole("button", { name: "Crear paquete" }));
    expect(await screen.findByText("Ya existe un paquete con el código YA-EXISTE.")).toBeTruthy();
    await user.clear(within(form).getByLabelText("Código de seguimiento"));
    await user.type(within(form).getByLabelText("Código de seguimiento"), "NUEVO-1");
    await user.click(within(form).getByRole("button", { name: "Crear paquete" }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/paquetes\/[0-9a-f-]{36}$/));
    expect(await screen.findByRole("region", { name: "Historial" })).toBeTruthy();
  });
});

describe("importación", () => {
  it("subir → columnas sugeridas → revisar errores por fila → importar", async () => {
    const api = new FakeApi();
    const user = await panel(api, "#/paquetes/importar");
    await user.upload(await screen.findByLabelText("Archivo para importar"), new File(["Guía;Destinatario;Dirección\n"], "envios.csv", { type: "text/csv" }));
    const columns = await screen.findByRole("region", { name: "Columnas" });
    expect((within(columns).getByLabelText("Código de seguimiento *") as HTMLSelectElement).value).toBe("Guía");
    // La dirección no se reconoció: se elige a mano.
    await user.selectOptions(within(columns).getByLabelText("Dirección completa"), "Dirección");
    await user.click(within(columns).getByRole("button", { name: "Revisar las filas" }));
    const review = await screen.findByRole("region", { name: "Revisión" });
    expect(review.textContent).toContain("2 filas listas para importar y 1 con errores");
    expect(within(review).getByText("Código repetido (también en la fila 2).")).toBeTruthy();
    await user.click(within(review).getByRole("button", { name: "Importar 2 paquetes" }));
    expect(await screen.findByText("Importación terminada")).toBeTruthy();
    expect(api.lastMapping).toMatchObject({ tracking_code: "Guía", address: "Dirección" });
  });
});

function delivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  const p = fakePackage();
  return {
    id: "0192f3a0-0000-7000-8001-000000000001",
    package_id: p.id,
    driver: "Ana (demo)",
    started_at: new Date().toISOString(),
    ended_at: null,
    duration_s: 120,
    outcome: "DELIVERED",
    outcome_attribution: "NONE",
    notes: "",
    is_second_attempt: false,
    end_location: null,
    evidence: [],
    package: { id: p.id, tracking_code: p.tracking_code, recipient_name: p.recipient_name, status: "DELIVERED", address: { raw_text: p.address.raw_text, location: null } },
    ...overrides,
  };
}

describe("entregas e incidencias", () => {
  it("las entregas del día con su resultado", async () => {
    const api = new FakeApi();
    api.deliveries = [delivery(), delivery({ id: "0192f3a0-0000-7000-8001-000000000002", outcome: "NO_ANSWER" })];
    await panel(api, "#/entregas");
    const table = await screen.findByRole("region", { name: "Entregas del día" });
    expect(table.textContent).toContain("1 entregadas · 1 no entregadas");
    expect(within(table).getByText("Nadie responde")).toBeTruthy();
  });

  it("incidencias abiertas con su foto, y se marcan resueltas", async () => {
    const api = new FakeApi();
    const incident: Incident = {
      id: "0192f3a0-0000-7000-8002-000000000001",
      type: "WRONG_ADDRESS",
      description: "No existe la altura",
      status: "OPEN",
      occurred_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by: null,
      driver: "Ana (demo)",
      visit_id: null,
      evidence: [{ id: "0192f3a0-0000-7000-8003-000000000001" }],
      package: { id: "0192f3a0-0000-7000-a000-000000000099", tracking_code: "INC-1", recipient_name: "Beto", status: "FAILED", address: "Mitre 1" },
    };
    api.incidents = [incident];
    const user = await panel(api, "#/entregas?vista=incidencias");
    const list = await screen.findByRole("list", { name: "Incidencias" });
    expect(within(list).getByText("Dirección incorrecta")).toBeTruthy();
    expect(within(list).getByText("No existe la altura")).toBeTruthy();
    await user.click(within(list).getByRole("button", { name: "Marcar resuelta" }));
    expect(await screen.findByText("No hay incidencias abiertas.")).toBeTruthy();
  });
});
