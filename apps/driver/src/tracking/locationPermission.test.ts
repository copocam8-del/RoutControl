/** Permiso de ubicación: cuándo se pide y qué pasa si está bloqueado. */
import { describe, expect, it } from "vitest";

import { LocationError } from "../device/DeviceServices";
import { describeDevice } from "../device/web";
import { settle, setup } from "../test/helpers";

describe("pedido del permiso de ubicación", () => {
  it("start() pide la ubicación en el mismo toque, antes de cualquier espera (iOS lo exige)", async () => {
    const env = await setup();
    await env.workday.resume();
    void env.workday.start();
    expect(env.device.currentCalls).toBe(1); // sin await de por medio
    await settle();
    expect(env.workday.getState().phase).toBe("active");
  });

  it("también si la jornada guardada todavía se está recuperando", async () => {
    const env = await setup();
    const resuming = env.workday.resume();
    void env.workday.start();
    expect(env.device.currentCalls).toBe(1);
    await resuming;
    await settle();
    expect(env.workday.getState().phase).toBe("active");
    expect(env.backend.workdays.size).toBe(1);
  });

  it("dos toques seguidos crean una sola jornada", async () => {
    const env = await setup();
    await env.workday.resume();
    void env.workday.start();
    void env.workday.start();
    await settle();
    expect(env.backend.workdays.size).toBe(1);
  });

  it("con la jornada ya iniciada no vuelve a pedir la ubicación de inicio", async () => {
    const env = await setup();
    await env.workday.resume();
    await env.workday.start();
    const calls = env.device.currentCalls;
    await env.workday.start();
    expect(env.device.currentCalls).toBe(calls);
  });
});

describe("permiso bloqueado", () => {
  it("no inicia la jornada ni guarda nada, y lo dice claramente", async () => {
    const env = await setup();
    await env.workday.resume();
    env.device.nextFix = new LocationError("permission_denied");
    await env.workday.start();
    expect(env.workday.getState()).toMatchObject({ phase: "idle", gps: "denied", workday: null });
    expect(env.workday.getState().error).toBe("No se puede iniciar la jornada sin ubicación: el permiso está bloqueado.");
    expect(env.backend.callsTo("/workdays/start")).toHaveLength(0);
    expect(await env.db.workdays.count()).toBe(0);
    expect(await env.db.points.count()).toBe(0);
  });

  it("sin señal de ubicación (no por permiso) tampoco inicia, con otro mensaje", async () => {
    const env = await setup();
    await env.workday.resume();
    env.device.nextFix = new LocationError("timeout");
    await env.workday.start();
    expect(env.workday.getState()).toMatchObject({ phase: "idle", gps: "error" });
    expect(env.workday.getState().error).toContain("la jornada no se inició");
    expect(env.backend.callsTo("/workdays/start")).toHaveLength(0);
  });

  it("al volver de Ajustes con el permiso habilitado, se saca el aviso", async () => {
    const env = await setup();
    await env.workday.resume();
    env.device.nextFix = new LocationError("permission_denied");
    env.device.permissionState = "denied";
    await env.workday.start();
    env.device.setVisible(false);
    env.device.setVisible(true);
    await settle();
    expect(env.workday.getState().gps).toBe("denied"); // sigue bloqueado: el aviso queda

    env.device.permissionState = "prompt";
    env.device.setVisible(false);
    env.device.setVisible(true);
    await settle();
    expect(env.workday.getState()).toMatchObject({ gps: "off", error: null });
  });

  it("si se quita el permiso con la jornada en curso, el recorrido se retoma al volver a la app", async () => {
    const env = await setup();
    await env.workday.resume();
    await env.workday.start();
    env.device.emitWatchError(new LocationError("permission_denied"));
    expect(env.workday.getState()).toMatchObject({ phase: "active", gps: "denied" });
    expect(env.device.watchers.size).toBe(0);

    env.device.setVisible(false);
    env.device.setVisible(true);
    await settle();
    expect(env.workday.getState().gps).toBe("watching");
    expect(env.device.watchers.size).toBe(1);
  });
});

describe("tipo de teléfono (para mostrar los pasos que corresponden)", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1", 5, "ios"],
    ["Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", 5, "android"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15", 5, "ios"], // iPad
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15", 0, "other"], // Mac
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36", 0, "other"],
  ] as const)("%s → %s", (ua, touch, platform) => {
    expect(describeDevice(ua, touch).platform).toBe(platform);
  });
});
