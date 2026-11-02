/** Alertas configurables del panel (ADR-025). */
import { ApiClient } from "@routcontrol/api-client";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminApp } from "./adminApp";
import { App } from "./App";
import { FakeApi } from "./test/fakeApi";

vi.mock("@routcontrol/ui/map", () => ({ TrackMap: () => <div />, PositionsMap: () => <div /> }));

beforeEach(() => {
  window.location.hash = "";
});

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send() {}
  close() {}
}

const notification = (o: Record<string, unknown> = {}) => ({
  id: "0192f3a0-0000-7000-8005-000000000001",
  type: "INCIDENT",
  title: "Incidencia: Nadie responde",
  body: "P-1 · Mitre 100",
  payload: { package_id: "0192f3a0-0000-7000-a000-000000000001" },
  created_at: new Date().toISOString(),
  unread: true,
  ...o,
});

async function panel(api: FakeApi, hash = "", socket = false) {
  window.location.hash = hash;
  const app = createAdminApp({
    api: new ApiClient("/api/v1", api.fetch, { getRetryDelayMs: 0 }),
    live: { WebSocketImpl: socket ? (FakeSocket as unknown as typeof WebSocket) : null, retryDelayMs: () => 0 },
  });
  render(<App app={app} welcomeMs={0} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "duenio@norte.demo");
  await user.type(screen.getByLabelText("Contraseña"), "demo");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
  return { user, app };
}

describe("alertas", () => {
  it("el contador de nuevas está en la barra lateral; al abrir Alertas quedan vistas", async () => {
    const api = new FakeApi();
    api.notifications = [notification(), notification({ id: "0192f3a0-0000-7000-8005-000000000002", type: "NO_SIGNAL", title: "Ana está sin señal", body: "Última ubicación hace 20 min.", payload: { workday_id: "0192f3a0-0000-7000-8000-0000000000aa" }, unread: false })];
    api.unread = 1;
    const { user } = await panel(api);
    const nav = await screen.findByRole("navigation", { name: "Secciones" });
    expect(await within(nav).findByLabelText("1 nuevas")).toBeTruthy();
    await user.click(within(nav).getByRole("link", { name: /Alertas/ }));
    const list = await screen.findByRole("list", { name: "Alertas" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("Incidencia: Nadie responde");
    expect(within(items[0]!).getByRole("link").getAttribute("href")).toBe("#/paquetes/0192f3a0-0000-7000-a000-000000000001");
    expect(within(items[1]!).getByRole("link").getAttribute("href")).toBe("#/jornadas/0192f3a0-0000-7000-8000-0000000000aa");
    await waitFor(() => expect(api.seenCalls).toBe(1));
    await waitFor(() => expect(within(nav).queryByLabelText(/nuevas/)).toBeNull());
  });

  it("en vivo: llega por el WebSocket del inicio, suma al contador y aparece un aviso", async () => {
    const api = new FakeApi();
    await panel(api, "", true);
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    const ws = FakeSocket.last!;
    act(() => {
      ws.onopen?.();
      ws.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
      ws.onmessage?.({ data: JSON.stringify({ type: "notification", notification: notification({ title: "Ana terminó su recorrido", type: "ROUTE_FINISHED", body: "12 entregados y 1 no entregados." }) }) });
    });
    const toast = await screen.findByRole("status", { name: "Nueva alerta" });
    expect(toast.textContent).toContain("Ana terminó su recorrido");
    expect(within(screen.getByRole("navigation", { name: "Secciones" })).getByLabelText("1 nuevas")).toBeTruthy();
  });
});

describe("configuración", () => {
  it("se apagan alertas, se cambia el umbral de sin señal y se guardan los umbrales", async () => {
    const api = new FakeApi();
    const { user } = await panel(api, "#/configuracion");
    const form = await screen.findByRole("form", { name: "Configuración de la empresa" });
    await user.click(within(form).getByLabelText("Inicio de jornada"));
    const minutes = within(form).getByLabelText("Avisar sin señal después de (minutos)");
    await user.clear(minutes);
    await user.type(minutes, "30");
    const green = within(form).getByLabelText("Verde desde (%)");
    await user.clear(green);
    await user.type(green, "75");
    await user.click(within(form).getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Configuración guardada.")).toBeTruthy();
    expect(api.savedSettings[0]).toMatchObject({
      alerts: { workday_started: false, no_signal_minutes: 30 },
      reception: { green: 0.75, yellow: 0.4 },
    });
  });

  it("un supervisor la ve pero no la puede cambiar", async () => {
    const api = new FakeApi();
    api.settings = { ...api.settings, can_edit: false };
    await panel(api, "#/configuracion");
    expect(await screen.findByText("Solo el dueño o un administrador pueden cambiar la configuración.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
    // Deshabilitado por el fieldset (no por el atributo propio del campo).
    expect(screen.getByLabelText("Inicio de jornada").matches(":disabled")).toBe(true);
  });
});
