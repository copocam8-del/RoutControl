/**
 * La PWA contra el Django REAL, a través del proxy de Vite (http://localhost:5173/api → :8000).
 * Usa las piezas reales de la app (ApiClient, BatchSender, WorkdayController); solo el teléfono
 * (ubicación, red) es simulado. Detecta diferencias entre el backend falso de las pruebas y el real.
 *
 * Requiere: `pnpm backend:dev`, `pnpm backend:seed` y `pnpm driver:dev`.
 */
import { uuidv7 } from "@routcontrol/domain";
import { beforeAll, describe, expect, it } from "vitest";

import { ApiClient, ApiError } from "../api/client";
import { config } from "../config";
import { BatchSender } from "../sync/batchSender";
import { browserLikeFetch } from "../test/browserLikeFetch";
import { FakeDevice } from "../test/fakeDevice";
import { freshDb, settle } from "../test/helpers";
import { WorkdayController } from "../tracking/workdayController";

// Corre en Node; la app se tipa como código de navegador, así que el entorno se lee acotado acá.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const ORIGIN = env.RC_PWA_ORIGIN ?? "http://localhost:5173";
const PASSWORD = env.DEMO_PASSWORD ?? "routcontrol-demo";
const DRIVER = "repartidor2@norte.demo";

function phone() {
  const device = new FakeDevice();
  const browser = browserLikeFetch(ORIGIN, { online: () => device.isOnline });
  const api = new ApiClient(`${ORIGIN}/api/v1`, browser.fetch);
  const db = freshDb();
  const sender = new BatchSender({ db, api, batchSize: 50, isOnline: () => device.isOnline });
  const workday = new WorkdayController({ db, api, device, sender, config });
  return { device, browser, api, db, sender, workday };
}

/** Si quedó una jornada activa de una corrida anterior, se cierra (la PWA ofrece lo mismo). */
async function ensureNoActiveWorkday(api: ApiClient) {
  const current = await api.currentWorkday();
  if (current) await api.endWorkday(current.id, { ended_at: new Date().toISOString(), location: null });
}

beforeAll(async () => {
  const response = await fetch(`${ORIGIN}/api/v1/schema/`).catch(() => null);
  if (!response?.ok) throw new Error(`No responde ${ORIGIN}/api/v1 (¿están corriendo Vite y Django?)`);
});

describe("PWA contra el backend real (por el proxy de Vite)", () => {
  it("login: la respuesta real cumple el contrato y el refresh queda solo en la cookie", async () => {
    const p = phone();
    const result = await p.api.login(DRIVER, PASSWORD);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.session.role).toBe("DRIVER");
    expect(p.browser.jar.has("rc_refresh")).toBe(true);
    expect(p.browser.jar.get("rc_refresh")!.path).toBe("/api/v1/auth/");
  });

  it("credenciales incorrectas → el mismo error que muestra la app", async () => {
    const error = await phone().api.login(DRIVER, "incorrecta").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.message).toBe("Email o contraseña incorrectos.");
  });

  it("un usuario en dos empresas recibe la lista para elegir", async () => {
    const result = await phone().api.login("supervisor@ambas.demo", PASSWORD);
    expect(result.kind).toBe("choose");
    if (result.kind === "choose") expect(result.options).toHaveLength(2);
  });

  it("reabrir la app: la sesión se recupera con la cookie (refresh real, con Origin)", async () => {
    const p = phone();
    await p.api.login(DRIVER, PASSWORD);
    const reopened = new ApiClient(`${ORIGIN}/api/v1`, p.browser.fetch); // memoria vacía, misma cookie
    expect(reopened.hasAccessToken).toBe(false);
    expect(await reopened.refresh()).toBe(true);
    expect((await reopened.me()).role).toBe("DRIVER");
  });

  it("jornada completa: iniciar, puntos, sin señal, volver la señal, finalizar", async () => {
    const p = phone();
    await p.api.login(DRIVER, PASSWORD);
    await ensureNoActiveWorkday(p.api);
    await p.workday.resume();

    await p.workday.start();
    expect(p.workday.getState()).toMatchObject({ phase: "active", gps: "watching", error: null });
    const workdayId = p.workday.getState().workday!.id;
    expect((await p.api.currentWorkday())?.id).toBe(workdayId);

    // Puntos con la app abierta.
    // Cada 20 s y ~45 m: los tres se guardan (un poco "adelantados", dentro de la tolerancia del servidor).
    const t = Date.now();
    for (const [i, lat] of [-34.6034, -34.603, -34.6026].entries()) {
      p.device.emitFix(p.device.fixAt(t + (i + 1) * 20_000, lat));
      await settle();
    }
    let status = await p.sender.flush();
    expect(status.kind).toBe("synced");
    const firstOk = (await p.db.log.toArray()).filter((r) => r.kind === "batch_ok");
    expect(firstOk.length).toBeGreaterThan(0);
    expect((await p.db.log.toArray()).filter((r) => r.kind === "rejected")).toEqual([]);

    // Modo avión: los puntos se guardan en el teléfono y finalizar queda pendiente.
    p.device.setOnline(false);
    p.device.emitFix(p.device.fixAt(t + 80_000, -34.602)); // posterior a los anteriores
    await settle();
    status = await p.sender.flush();
    expect(status.kind).toBe("offline");
    expect(status.pending).toBeGreaterThan(0);
    await p.workday.end();
    expect(p.workday.getState().phase).toBe("ending");
    expect(await p.db.points.count()).toBeGreaterThan(0);

    // Vuelve la señal: se envía todo (el token sirve después del fin, ADR-003) y se finaliza.
    p.device.setOnline(true);
    await settle(80);
    await p.workday.retryPending();
    expect(p.workday.getState()).toMatchObject({ phase: "idle", workday: null });
    expect(await p.db.points.count()).toBe(0);
    expect(await p.db.workdays.count()).toBe(0);
    expect(await p.api.currentWorkday()).toBeNull();
    expect((await p.db.log.toArray()).filter((r) => r.kind === "rejected")).toEqual([]);
  });

  it("reenviar puntos ya enviados (respuesta perdida) no duplica: el servidor los da por duplicados", async () => {
    const p = phone();
    await p.api.login(DRIVER, PASSWORD);
    await ensureNoActiveWorkday(p.api);
    await p.workday.resume();
    await p.workday.start();
    const w = p.workday.getState().workday!;
    const point = {
      point_id: uuidv7(),
      recorded_at: new Date().toISOString(),
      lat: -34.6,
      lng: -58.4,
      accuracy: 10,
      source: "FOREGROUND" as const,
    };
    const first = await p.api.postBatch(w.tracking_token, { points: [point] });
    const again = await p.api.postBatch(w.tracking_token, { points: [point] });
    expect(first.accepted).toEqual([point.point_id]);
    expect(again.duplicates).toEqual([point.point_id]);
    await p.workday.end();
  });

  it("los motivos de rechazo reales llegan con detalle", async () => {
    const p = phone();
    await p.api.login(DRIVER, PASSWORD);
    await ensureNoActiveWorkday(p.api);
    await p.workday.resume();
    await p.workday.start();
    const w = p.workday.getState().workday!;
    const before = { point_id: uuidv7(), recorded_at: "2020-01-01T00:00:00.000Z", lat: 0, lng: 0, accuracy: 5, source: "FOREGROUND" as const };
    const r = await p.api.postBatch(w.tracking_token, { points: [before] });
    expect(r.rejected).toEqual([{ id: before.point_id, reason: "before_workday_start", detail: expect.any(String) }]);
    await p.workday.end();
  });

  it("si otra instalación ya tiene la jornada abierta, la app lo detecta y puede cerrarla", async () => {
    const first = phone();
    await first.api.login(DRIVER, PASSWORD);
    await ensureNoActiveWorkday(first.api);
    await first.workday.resume();
    await first.workday.start();

    const second = phone();
    await second.api.login(DRIVER, PASSWORD);
    await second.workday.resume();
    await second.workday.start();
    expect(second.workday.getState().conflict?.status).toBe("ACTIVE");
    await second.workday.closeServerConflict();
    expect(await second.api.currentWorkday()).toBeNull();
  });

  it("logout: el refresh deja de servir", async () => {
    const p = phone();
    await p.api.login(DRIVER, PASSWORD);
    await p.api.logout();
    expect(await p.api.refresh()).toBe(false);
  });
});
