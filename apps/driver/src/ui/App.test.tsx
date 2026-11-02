import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ApiClient } from "../api/client";
import { createApp } from "../app";
import type { SyncStatus } from "../sync/batchSender";
import { FakeBackend } from "../test/fakeBackend";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb } from "../test/helpers";
import { App } from "./App";
import { describeSync } from "./SyncIndicator";

function renderApp() {
  const backend = new FakeBackend();
  const device = new FakeDevice();
  const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch), device });
  render(<App app={app} welcomeMs={0} />);
  return { app, backend, device, user: userEvent.setup() };
}

/** Como una persona: espera a que el botón esté habilitado antes de tocarlo. */
async function enabledButton(name: string): Promise<HTMLButtonElement> {
  return waitFor(() => {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    return button;
  });
}

async function login(user: ReturnType<typeof userEvent.setup>, email = "repartidor@demo.test") {
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Contraseña"), "secreta");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
}

describe("indicador de sincronización", () => {
  const now = Date.now();
  it.each<[SyncStatus, string]>([
    [{ kind: "synced", pending: 0, lastSyncAt: now }, "Conectado y actualizado"],
    [{ kind: "offline", pending: 3, lastSyncAt: null, nextRetryAt: null }, "Sin conexión, cambios guardados"],
    [{ kind: "syncing", pending: 3, lastSyncAt: null }, "Sincronizando…"],
    [{ kind: "error", pending: 1, lastSyncAt: null, message: "x", nextRetryAt: null }, "Error de sincronización"],
  ])("%o → %s", (status, title) => {
    expect(describeSync(status, now).title).toBe(title);
  });
});

describe("App", () => {
  it("login → aviso de privacidad → jornada iniciada", async () => {
    const { user, backend } = renderApp();
    await login(user);

    await user.click(await enabledButton("Iniciar jornada"));
    // Aviso destacado ANTES de pedir el permiso (§5.4): todavía no se llamó al servidor.
    expect(await screen.findByRole("dialog", { name: "Antes de iniciar la jornada" })).toBeTruthy();
    expect(backend.callsTo("/workdays/start")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Entendido, iniciar jornada" }));
    expect(await screen.findByRole("button", { name: "Finalizar jornada" })).toBeTruthy();
    expect(await screen.findByText(/Registrando recorrido/)).toBeTruthy();
    expect(backend.workdays.size).toBe(1);
    // Con la jornada activa no se puede cerrar sesión (se perderían puntos).
    await user.click(screen.getByRole("button", { name: "Perfil" }));
    expect((screen.getByRole("button", { name: "Salir" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Para salir, primero finalizá la jornada.")).toBeTruthy();
  });

  it("el aviso se muestra una sola vez", async () => {
    const { user, app } = renderApp();
    await login(user);
    await app.db.meta.put({ key: "consent-accepted-v1", value: "ya" });
    await user.click(await enabledButton("Iniciar jornada"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByRole("button", { name: "Finalizar jornada" })).toBeTruthy();
  });

  it("un usuario que no es repartidor no entra a la app", async () => {
    const { user, backend } = renderApp();
    backend.users.push({ email: "duenio@demo.test", password: "secreta", role: "OWNER" });
    await login(user, "duenio@demo.test");
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Esta app es para repartidores. Para administrar, usá el panel.");
  });

  it("recupera la sesión con la cookie al reabrir (sin pedir login)", async () => {
    const backend = new FakeBackend();
    await new ApiClient("/api/v1", backend.fetch).login("repartidor@demo.test", "secreta"); // deja la "cookie"
    const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch), device: new FakeDevice() });
    render(<App app={app} welcomeMs={0} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar jornada" })).toBeTruthy());
  });
});
