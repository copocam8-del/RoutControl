import { describe, expect, it } from "vitest";

import { LocationError } from "../device/DeviceServices";
import { getMeta } from "../store/db";
import { settle, setup } from "../test/helpers";

describe("WorkdayController", () => {
  it("iniciar: pide ubicación, crea la jornada, guarda el punto del evento y empieza a seguir", async () => {
    const env = await setup();
    await env.workday.resume();
    await env.workday.start();

    const state = env.workday.getState();
    expect(state.phase).toBe("active");
    expect(state.gps).toBe("watching");
    expect(env.backend.workdays.size).toBe(1);
    await env.sender.flush();
    const [point] = [...env.backend.points.values()];
    expect(point).toMatchObject({ source: "EVENT", event: "workday_start" });
    // El inicio no es posterior a la ubicación del evento (si no, el servidor la rechazaría).
    const w = [...env.backend.workdays.values()][0]!;
    expect(Date.parse(w.started_at)).toBeLessThanOrEqual(Date.parse(point!.recorded_at as string));
  });

  it("sin permiso de ubicación no se puede iniciar", async () => {
    const env = await setup();
    await env.workday.resume();
    env.device.nextFix = new LocationError("permission_denied");
    await env.workday.start();
    expect(env.workday.getState()).toMatchObject({ phase: "idle", gps: "denied" });
    expect(env.workday.getState().error).toContain("permitir el acceso a la ubicación");
    expect(env.backend.workdays.size).toBe(0);
  });

  it("si falla la red al iniciar, el reintento usa el MISMO id de jornada", async () => {
    const env = await setup();
    await env.workday.resume();
    env.backend.online = false;
    await env.workday.start();
    expect(env.workday.getState().phase).toBe("idle");
    const firstId = env.backend.callsTo("/workdays/start")[0]!.body as { workday_id: string };

    env.backend.online = true;
    await env.workday.start();
    const secondId = env.backend.callsTo("/workdays/start")[1]!.body as { workday_id: string };
    expect(secondId.workday_id).toBe(firstId.workday_id);
    expect(env.workday.getState().phase).toBe("active");
    expect(await getMeta(env.db, "pendingStartWorkdayId")).toBeUndefined();
  });

  it("guarda puntos mientras la app está abierta y respeta el intervalo mínimo", async () => {
    const env = await setup();
    await env.workday.resume();
    await env.workday.start();
    // El punto del evento de inicio (en el Obelisco) cuenta como el último guardado.
    const t = Date.now();
    env.device.emitFix(env.device.fixAt(t + 1_000)); // mismo lugar, 1 s después: no se guarda
    await settle();
    env.device.emitFix(env.device.fixAt(t + 3_000, -34.6034)); // se movió ~33 m: se guarda
    await settle();
    env.device.emitFix(env.device.fixAt(t + 4_000, -34.6034)); // quieto, 1 s después: no
    await settle();
    env.device.emitFix(env.device.fixAt(t + 25_000, -34.6034)); // quieto, pero pasó el intervalo: sí
    await settle();
    await env.sender.flush();
    const saved = [...env.backend.points.values()].map((p) => [p.source, p.lat]);
    expect(saved).toEqual([
      ["EVENT", -34.6037],
      ["FOREGROUND", -34.6034],
      ["FOREGROUND", -34.6034],
    ]);
  });

  it("en segundo plano corta el GPS (el hueco lo marca el servidor) y lo retoma al volver", async () => {
    const env = await setup();
    await env.workday.resume();
    await env.workday.start();
    env.device.setVisible(false);
    await settle();
    expect(env.workday.getState().gps).toBe("paused");
    expect(env.device.watchers.size).toBe(0);
    env.device.setVisible(true);
    await settle();
    expect(env.workday.getState().gps).toBe("watching");
    expect(env.device.watchers.size).toBe(1);
  });

  it("finalizar sin señal: deja de registrar enseguida y envía el fin cuando vuelve la red", async () => {
    const env = await setup();
    await env.workday.resume();
    await env.workday.start();
    env.backend.online = false;
    env.device.isOnline = false;

    await env.workday.end();
    expect(env.workday.getState().phase).toBe("ending");
    expect(env.workday.getState().gps).toBe("off");
    expect(env.device.watchers.size).toBe(0);
    expect(env.workday.getState().error).toContain("cuando vuelva la señal");
    const pendingEnd = (await env.db.workdays.toArray())[0]!.end!;

    env.backend.online = true;
    env.device.setOnline(true);
    await settle(60);

    expect(env.workday.getState()).toMatchObject({ phase: "idle", workday: null });
    const w = [...env.backend.workdays.values()][0]!;
    expect(w.status).toBe("FINISHED");
    expect(w.ended_at).toBe(pendingEnd.ended_at); // la hora en que se tocó el botón, no la del reenvío
    // Llegaron los dos eventos y el teléfono quedó limpio (§11).
    expect([...env.backend.points.values()].map((p) => p.event)).toEqual(["workday_start", "workday_end"]);
    expect(await env.db.points.count()).toBe(0);
    expect(await env.db.workdays.count()).toBe(0);
  });

  it("al reabrir la app retoma la jornada activa guardada en el teléfono", async () => {
    const env = await setup();
    await env.workday.resume();
    await env.workday.start();
    env.workday.dispose();

    // "Recarga": un controlador nuevo sobre la misma base local.
    const { WorkdayController } = await import("./workdayController");
    const { config } = await import("../config");
    const reopened = new WorkdayController({ db: env.db, api: env.api, device: env.device, sender: env.sender, config });
    await reopened.resume();
    expect(reopened.getState()).toMatchObject({ phase: "active", gps: "watching" });
  });

  it("si el servidor ya tiene otra jornada activa, ofrece cerrarla", async () => {
    const env = await setup();
    await env.workday.resume();
    await env.workday.start();
    // Otro teléfono (otra base local) del mismo repartidor:
    const other = await setup({ loggedIn: false });
    other.backend.users = env.backend.users;
    const { WorkdayController } = await import("./workdayController");
    const { config } = await import("../config");
    const second = new WorkdayController({ db: other.db, api: env.api, device: other.device, sender: other.sender, config });
    await second.resume();
    await second.start();
    expect(second.getState().conflict?.status).toBe("ACTIVE");

    await second.closeServerConflict();
    expect(second.getState().conflict).toBeNull();
    await second.start();
    expect(second.getState().phase).toBe("active");
  });
});
