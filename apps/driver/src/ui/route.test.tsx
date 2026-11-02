/** "Armar mi ruta" en la PWA (ADR-015): orden de VROOM, orden a mano y sin señal. */
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

vi.mock("@routcontrol/ui/map", () => ({ TrackMap: () => <div data-testid="map" />, setOfflineTiles: () => {}, StopsMap: () => <div data-testid="stops-map" /> }));

async function ready() {
  const backend = new FakeBackend();
  backend.packages = [
    testPackage({ address: { ...testPackage().address, raw_text: "Primera 100" } }),
    testPackage({ address: { ...testPackage().address, raw_text: "Segunda 200" } }),
    testPackage({ address: { ...testPackage().address, raw_text: "Tercera 300" } }),
  ];
  const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch, { getRetryDelayMs: 0 }), device: new FakeDevice() });
  render(<App app={app} welcomeMs={0} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "repartidor@demo.test");
  await user.type(screen.getByLabelText("Contraseña"), "secreta");
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
  await user.click(await screen.findByRole("button", { name: "Iniciar jornada" }));
  await user.click(await screen.findByRole("button", { name: "Entendido, iniciar jornada" }));
  await screen.findByRole("button", { name: "Finalizar jornada" });
  await user.click(screen.getByRole("button", { name: "Paquetes" }));
  await screen.findByRole("list", { name: "Paquetes" });
  return { app, backend, user };
}

const order = () => within(screen.getByRole("list", { name: "Paquetes" })).getAllByRole("button").map((b) => b.textContent?.match(/(\w+) \d00/)?.[1]);

describe("Armar mi ruta", () => {
  it("ordena las paradas desde la ubicación actual y la jornada sigue ese orden", async () => {
    const { app, backend, user } = await ready();
    expect(order()).toEqual(["Primera", "Segunda", "Tercera"]);
    await user.click(screen.getByRole("button", { name: "Armar mi ruta" }));
    await waitFor(() => expect(order()).toEqual(["Tercera", "Segunda", "Primera"]));
    expect(backend.routeStart).toMatchObject({ lat: -34.6037, lng: -58.3816 }); // la ubicación del teléfono
    expect(screen.getByText(/Ruta armada · 4,5 km · unos 15 min de manejo/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Inicio" }));
    const next = await screen.findByRole("region", { name: "Próxima parada" });
    expect(next.textContent).toContain("Tercera 300");
    app.workday.dispose();
  });

  it("editar el orden a mano: subir y bajar, y se guarda en el servidor", async () => {
    const { app, backend, user } = await ready();
    await user.click(screen.getByRole("button", { name: "Editar orden" }));
    await user.click(screen.getByRole("button", { name: "Bajar Primera 100" }));
    await user.click(screen.getByRole("button", { name: "Guardar orden" }));
    await waitFor(() => expect(order()).toEqual(["Segunda", "Primera", "Tercera"]));
    await waitFor(() => expect(backend.routeSource).toBe("MANUAL"));
    expect(backend.routeOrder).toEqual(backend.packages.map((p) => p.id).filter((_, i) => i !== 0).toSpliced(1, 0, backend.packages[0]!.id));
    app.workday.dispose();
  });

  it("si el servicio de ruteo no responde, lo dice y se puede ordenar a mano", async () => {
    const { app, backend, user } = await ready();
    backend.routingDown = true;
    await user.click(screen.getByRole("button", { name: "Armar mi ruta" }));
    expect(await screen.findByText("No se pudo armar la ruta ahora. Podés ordenar las paradas a mano.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Editar orden" })).toBeTruthy();
    app.workday.dispose();
  });

  it("sin señal no se puede armar, pero el orden a mano queda y se envía después", async () => {
    const { app, backend, user } = await ready();
    backend.online = false;
    await user.click(screen.getByRole("button", { name: "Armar mi ruta" }));
    // Con toda la suite en paralelo, el error de red tarda más de 1 s en llegar a la pantalla.
    expect(await screen.findByText(/Sin conexión: para armar la ruta hace falta señal/, undefined, { timeout: 5000 })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Editar orden" }));
    await user.click(screen.getByRole("button", { name: "Subir Tercera 300" }));
    await user.click(screen.getByRole("button", { name: "Guardar orden" }));
    await waitFor(() => expect(order()).toEqual(["Primera", "Tercera", "Segunda"]), { timeout: 5000 });
    expect(app.outbox.getStatus().pending).toBe(1);
    backend.online = true;
    await app.outbox.flush();
    expect(backend.routeSource).toBe("MANUAL");
    app.workday.dispose();
  }, 15_000);
});
