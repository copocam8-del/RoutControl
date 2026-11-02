/** Indicador de recepción del domicilio en la app (ADR-022): ficha e inicio. */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "../api/client";
import { createApp } from "../app";
import { FakeBackend } from "../test/fakeBackend";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb } from "../test/helpers";
import { testPackage } from "../test/packages";
import { App } from "./App";

vi.mock("@routcontrol/ui/map", () => ({ TrackMap: () => <div />, setOfflineTiles: () => {}, StopsMap: () => <div /> }));

async function open(packages: ReturnType<typeof testPackage>[], startWorkday = false) {
  const backend = new FakeBackend();
  backend.packages = packages;
  const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch, { getRetryDelayMs: 0 }), device: new FakeDevice() });
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
  return { app, user };
}

describe("indicador de recepción en la app", () => {
  it("la ficha muestra si el domicilio suele recibir; sin dato (paquetes viejos), nada", async () => {
    const { app, user } = await open([
      testPackage({ recipient_name: "Ana (prueba)", reception: { level: "green", score: 0.9, computable: 6 } }),
      testPackage({ recipient_name: "Beto (prueba)" }),
    ]);
    await user.click(screen.getByRole("button", { name: "Paquetes" }));
    await user.click(await screen.findByRole("button", { name: /Ana \(prueba\)/ }));
    expect(within(screen.getByRole("region", { name: "Destino" })).getByText("Suele recibir")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Volver" }));
    await user.click(await screen.findByRole("button", { name: /Beto \(prueba\)/ }));
    expect(within(screen.getByRole("region", { name: "Destino" })).queryByText(/Suele|Sin historial|A veces/)).toBeNull();
    app.workday.dispose();
  });

  it("la próxima parada del inicio lleva el chip, como la maqueta", async () => {
    const { app } = await open([testPackage({ reception: { level: "red", score: 0.2, computable: 4 } })], true);
    const next = await screen.findByRole("region", { name: "Próxima parada" });
    expect(within(next).getByText("Suele no estar")).toBeTruthy();
    app.workday.dispose();
  });
});
