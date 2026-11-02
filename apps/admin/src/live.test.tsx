/** Mapa en vivo por WebSocket (ADR-017). */
import { ApiClient } from "@routcontrol/api-client";
import type { LivePosition } from "@routcontrol/domain";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminApp } from "./adminApp";
import { App } from "./App";
import { connectLive, liveUrl } from "./live";
import { driver, FakeApi } from "./test/fakeApi";

vi.mock("@routcontrol/ui/map", () => ({
  TrackMap: () => <div />,
  PositionsMap: ({ positions }: { positions: Array<{ label: string; lat: number; stale: boolean }> }) => (
    <div data-testid="positions">{positions.map((p) => `${p.label} ${p.lat}${p.stale ? " (sin señal)" : ""}`).join(", ")}</div>
  ),
}));

/** WebSocket falso: guarda lo que se manda y deja simular al servidor. */
class FakeSocket {
  static all: FakeSocket[] = [];
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  // Lado servidor
  open() {
    this.onopen?.();
  }
  push(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

const Socket = FakeSocket as unknown as typeof WebSocket;

beforeEach(() => {
  FakeSocket.all = [];
  window.location.hash = "";
});

const position = (o: Partial<LivePosition> = {}): LivePosition => ({
  type: "position",
  driver_id: "d1",
  workday_id: "w1",
  lat: -34.6,
  lng: -58.4,
  recorded_at: new Date().toISOString(),
  ...o,
});

describe("cliente del mapa en vivo", () => {
  it("la URL sale del origen del panel o de la API, con ws/wss", () => {
    expect(liveUrl("", "https://panel.ejemplo.com/#/")).toBe("wss://panel.ejemplo.com/ws/live");
    expect(liveUrl("http://localhost:8000")).toBe("ws://localhost:8000/ws/live");
  });

  it("se autentica con el primer mensaje (no en la URL), entrega posiciones y reintenta renovando el token si lo rechazan", async () => {
    const tokens: boolean[] = [];
    const statuses: string[] = [];
    const got: LivePosition[] = [];
    const stop = connectLive({
      origin: "http://api.test",
      getToken: async (force) => {
        tokens.push(force);
        return force ? "nuevo" : "viejo";
      },
      onPosition: (p) => got.push(p),
      onStatus: (s) => statuses.push(s),
      WebSocketImpl: Socket,
      retryDelayMs: () => 0,
    });
    await waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    const first = FakeSocket.all[0]!;
    expect(first.url).toBe("ws://api.test/ws/live");
    first.open();
    expect(first.sent).toEqual([{ type: "auth", access: "viejo" }]);
    first.push({ type: "error", detail: "Sin permiso" });
    first.drop(4403);
    await waitFor(() => expect(FakeSocket.all).toHaveLength(2));
    const second = FakeSocket.all[1]!;
    second.open();
    expect(second.sent).toEqual([{ type: "auth", access: "nuevo" }]);
    expect(tokens).toEqual([false, true]);
    second.push({ type: "ready" });
    second.push(position());
    second.push({ type: "position", lat: "basura" }); // se ignora
    expect(got).toHaveLength(1);
    expect(statuses.at(-1)).toBe("live");
    stop();
    expect(second.closed).toBe(true);
    second.drop();
    await new Promise((r) => setTimeout(r, 5));
    expect(FakeSocket.all).toHaveLength(2); // después de cerrar no reintenta
  });
});

describe("inicio con mapa en vivo", () => {
  it("una ubicación en vivo mueve el punto, saca el 'sin señal' y muestra 'En vivo'", async () => {
    const api = new FakeApi();
    const ana = driver("Ana (demo)", true, true);
    api.drivers = [ana];
    const app = createAdminApp({ api: new ApiClient("/api/v1", api.fetch, { getRetryDelayMs: 0 }), live: { WebSocketImpl: Socket, retryDelayMs: () => 0 } });
    render(<App app={app} welcomeMs={0} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "duenio@norte.demo");
    await user.type(screen.getByLabelText("Contraseña"), "demo");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect((await screen.findByTestId("positions")).textContent).toContain("(sin señal)");
    await waitFor(() => expect(FakeSocket.all.length).toBeGreaterThan(0));
    const ws = FakeSocket.all.at(-1)!;
    act(() => {
      ws.open();
      ws.push({ type: "ready" });
    });
    expect(await screen.findByText("En vivo")).toBeTruthy();
    // De otra jornada (o de otra empresa, que el servidor nunca manda): no se aplica.
    act(() => ws.push(position({ driver_id: ana.id, workday_id: "otra", lat: -10 })));
    expect(screen.getByTestId("positions").textContent).not.toContain("-10");
    act(() => ws.push(position({ driver_id: ana.id, workday_id: ana.active_workday!.id, lat: -34.7 })));
    await waitFor(() => expect(screen.getByTestId("positions").textContent).toBe("Ana (demo) -34.7"));
    act(() => ws.drop());
    expect(await screen.findByText(/^Actualizado/)).toBeTruthy();
  });
});
