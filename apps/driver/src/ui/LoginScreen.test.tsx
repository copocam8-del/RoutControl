import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ApiClient } from "../api/client";
import { createApp } from "../app";
import { FakeBackend } from "../test/fakeBackend";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb } from "../test/helpers";
import { App } from "./App";

function renderApp() {
  const backend = new FakeBackend();
  const app = createApp({ db: freshDb(), api: new ApiClient("/api/v1", backend.fetch), device: new FakeDevice() });
  render(<App app={app} />);
  return { backend, user: userEvent.setup() };
}

describe("formulario de login (teclados de teléfono)", () => {
  it("el email no se autocapitaliza ni se autocorrige", async () => {
    renderApp();
    const email = (await screen.findByLabelText("Email")) as HTMLInputElement;
    expect(email.type).toBe("email");
    expect(email.getAttribute("autocapitalize")).toBe("off");
    expect(email.getAttribute("autocorrect")).toBe("off");
    expect(email.getAttribute("spellcheck")).toBe("false");
    expect(email.getAttribute("autocomplete")).toBe("username");
  });

  it("la contraseña tampoco", async () => {
    renderApp();
    const password = (await screen.findByLabelText("Contraseña")) as HTMLInputElement;
    expect(password.type).toBe("password");
    expect(password.getAttribute("autocapitalize")).toBe("off");
    expect(password.getAttribute("autocorrect")).toBe("off");
    expect(password.getAttribute("spellcheck")).toBe("false");
  });

  it("'Mostrar contraseña' deja ver lo que se escribió", async () => {
    const { user } = renderApp();
    const password = (await screen.findByLabelText("Contraseña")) as HTMLInputElement;
    await user.click(screen.getByLabelText("Mostrar contraseña"));
    expect(password.type).toBe("text");
  });

  it("manda el email sin espacios y en minúsculas; la contraseña, tal cual", async () => {
    const { user, backend } = renderApp();
    await user.type(await screen.findByLabelText("Email"), "  Repartidor@Demo.test ");
    await user.type(screen.getByLabelText("Contraseña"), "secreta");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    const body = backend.callsTo("/auth/login")[0]!.body as { email: string; password: string };
    expect(body).toEqual({ email: "repartidor@demo.test", password: "secreta" });
    expect(await screen.findByRole("button", { name: "Iniciar jornada" })).toBeTruthy();
  });
});
