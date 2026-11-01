import { describe, expect, it } from "vitest";

import { FakeBackend } from "../test/fakeBackend";
import { ApiClient, ApiError, NetworkError } from "./client";

function make() {
  const backend = new FakeBackend();
  return { backend, api: new ApiClient("/api/v1", backend.fetch) };
}

describe("ApiClient", () => {
  it("login: el access token queda solo en memoria, nunca en localStorage", async () => {
    const { api } = make();
    const result = await api.login("repartidor@demo.test", "secreta");
    expect(result.kind).toBe("ok");
    expect(api.hasAccessToken).toBe(true);
    expect(JSON.stringify({ ...localStorage })).not.toContain("access-");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("access-");
  });

  it("manda las cookies (credentials: include) en todas las peticiones", async () => {
    const backend = new FakeBackend();
    const seen: RequestInit[] = [];
    const api = new ApiClient("/api/v1", (input, init) => {
      seen.push(init!);
      return backend.fetch(input, init);
    });
    await api.login("repartidor@demo.test", "secreta");
    await api.me();
    expect(seen.every((i) => i.credentials === "include")).toBe(true);
  });

  it("si el access venció, renueva con la cookie y repite la petición una vez", async () => {
    const { api, backend } = make();
    await api.login("repartidor@demo.test", "secreta");
    backend.expireAccessTokens();
    const me = await api.me();
    expect(me.role).toBe("DRIVER");
    expect(backend.callsTo("/auth/refresh")).toHaveLength(1);
    expect(backend.callsTo("/auth/me")).toHaveLength(2);
  });

  it("varios 401 a la vez comparten un solo refresh (el refresh es rotativo)", async () => {
    const { api, backend } = make();
    await api.login("repartidor@demo.test", "secreta");
    backend.expireAccessTokens();
    await Promise.all([api.me(), api.me(), api.currentWorkday()]);
    expect(backend.callsTo("/auth/refresh")).toHaveLength(1);
  });

  it("sin sesión (cookie vencida) devuelve 401 sin bucles", async () => {
    const { api, backend } = make();
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(backend.callsTo("/auth/refresh").length).toBeLessThanOrEqual(2);
  });

  it("si el usuario está en varias empresas, pide elegir", async () => {
    const { api, backend } = make();
    backend.users[0]!.orgs = [
      { id: "0192f3a0-0000-7000-8000-000000000001", name: "Norte" },
      { id: "0192f3a0-0000-7000-8000-000000000002", name: "Sur" },
    ];
    const result = await api.login("repartidor@demo.test", "secreta");
    expect(result).toMatchObject({ kind: "choose", options: [{ name: "Norte" }, { name: "Sur" }] });
  });

  it("credenciales incorrectas → ApiError con el mensaje del servidor", async () => {
    const { api } = make();
    const error = await api.login("repartidor@demo.test", "mal").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("Email o contraseña incorrectos.");
  });

  it("sin red → NetworkError (distinto de un error del servidor)", async () => {
    const { api, backend } = make();
    backend.online = false;
    await expect(api.login("a@b.c", "x")).rejects.toBeInstanceOf(NetworkError);
  });

  it("el lote viaja con el token de seguimiento, no con la sesión", async () => {
    const { api, backend } = make();
    await api.postBatch("tok", { points: [] }).catch(() => undefined);
    const call = backend.callsTo("/tracking/batch")[0]!;
    expect(call.headers.Authorization).toBe("Tracking tok");
  });
});
