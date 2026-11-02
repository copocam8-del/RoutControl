import { uuidv7 } from "@routcontrol/domain";
import { describe, expect, it } from "vitest";

import type { DriverDB, LocalWorkday, PendingPoint } from "../store/db";
import { setup } from "../test/helpers";
import { TOKEN_INVALID_MESSAGE } from "./batchSender";

const START = "2026-10-31T12:00:00.000Z";

async function seedWorkday(env: Awaited<ReturnType<typeof setup>>, id = uuidv7()): Promise<LocalWorkday> {
  const response = await env.api.startWorkday({
    workday_id: id,
    started_at: START,
    device: { id: uuidv7(), runtime: "PWA", model: "x", os_version: "x", app_version: "x", location_permission: "while_in_use" },
    location: null,
  });
  const local: LocalWorkday = {
    id: response.workday.id,
    status: "ACTIVE",
    started_at: START,
    tracking_mode: "EVENTS_ONLY",
    tracking_token: response.tracking_token,
    tracking_token_expires_at: response.tracking_token_expires_at,
  };
  await env.db.workdays.put(local);
  return local;
}

async function queue(db: DriverDB, workdayId: string, minutes: number[]): Promise<PendingPoint[]> {
  const points = minutes.map((m, i) => ({
    point_id: uuidv7(),
    recorded_at: new Date(Date.parse(START) + m * 60_000).toISOString(),
    lat: -34.6,
    lng: -58.4,
    accuracy: 10,
    source: "FOREGROUND" as const,
    workday_id: workdayId,
    queued_at: i,
  }));
  await db.points.bulkPut(points);
  return points;
}

describe("BatchSender", () => {
  it("envía en lotes, en orden, y borra lo que el servidor aceptó", async () => {
    const env = await setup();
    const w = await seedWorkday(env);
    const points = await queue(env.db, w.id, [1, 2, 3, 4, 5, 6, 7]);

    const status = await env.sender.flush();

    expect(status.kind).toBe("synced");
    expect(await env.db.points.count()).toBe(0);
    const batches = env.backend.callsTo("/tracking/batch");
    expect(batches.map((c) => (c.body as { points: unknown[] }).points.length)).toEqual([3, 3, 1]);
    const sentOrder = batches.flatMap((c) => (c.body as { points: Array<{ point_id: string }> }).points.map((p) => p.point_id));
    expect(sentOrder).toEqual(points.map((p) => p.point_id));
    // Lo que viaja es el contrato del servidor, sin los campos locales.
    const first = (batches[0]!.body as { points: Array<Record<string, unknown>> }).points[0]!;
    expect(first).not.toHaveProperty("workday_id");
    expect(first).not.toHaveProperty("queued_at");
    expect(batches[0]!.headers.Authorization).toBe(`Tracking ${w.tracking_token}`);
    expect((batches[0]!.body as { sent_at: string }).sent_at).toMatch(/Z$/);
  });

  it("borra también duplicados y rechazados, que el servidor ya resolvió", async () => {
    const env = await setup();
    const w = await seedWorkday(env);
    const [dup] = await queue(env.db, w.id, [1]);
    env.backend.points.set(dup!.point_id, {}); // ya estaba en el servidor (reenvío)
    await queue(env.db, w.id, [-5]); // antes del inicio: rechazado para siempre

    await env.sender.flush();

    expect(await env.db.points.count()).toBe(0);
    const rejected = await env.db.log.where("at").above(0).filter((r) => r.kind === "rejected").toArray();
    expect(rejected[0]?.detail).toContain("before_workday_start");
  });

  it("sin red: guarda todo, avisa 'sin conexión' y reintenta con espera creciente", async () => {
    const env = await setup();
    const w = await seedWorkday(env);
    await queue(env.db, w.id, [1, 2]);
    env.backend.online = false;
    env.device.isOnline = false;

    let status = await env.sender.flush();
    expect(status).toMatchObject({ kind: "offline", pending: 2 });
    expect(env.timers.delays()).toEqual([5_000]);

    env.timers.runAll(); // pasa el primer reintento, sigue sin red
    status = await env.sender.flush();
    expect(env.timers.delays()).toEqual([15_000]);

    env.backend.online = true;
    env.device.isOnline = true;
    status = await env.sender.flush();
    expect(status.kind).toBe("synced");
    expect(env.backend.points.size).toBe(2);
    expect(env.timers.delays()).toEqual([]); // el éxito cancela el reintento programado
  });

  it("un error 500 se reintenta y no pierde puntos", async () => {
    const env = await setup();
    const w = await seedWorkday(env);
    await queue(env.db, w.id, [1]);
    env.backend.forced.set("/tracking/batch", [500]);

    const status = await env.sender.flush();
    expect(status.kind).toBe("error");
    expect(await env.db.points.count()).toBe(1);

    expect((await env.sender.flush()).kind).toBe("synced");
  });

  it("reenviar el mismo lote (respuesta perdida) no duplica en el servidor", async () => {
    const env = await setup();
    const w = await seedWorkday(env);
    const points = await queue(env.db, w.id, [1, 2]);
    await env.sender.flush();
    // Simula que la respuesta se perdió: los puntos vuelven a la cola y se reenvían.
    await env.db.points.bulkPut(points);
    await env.sender.flush();
    expect(env.backend.points.size).toBe(2);
    expect(await env.db.points.count()).toBe(0);
  });

  it("401: pide un token nuevo para la jornada (dentro de la gracia) y envía los puntos trabados", async () => {
    const env = await setup();
    const w = await seedWorkday(env);
    await queue(env.db, w.id, [1, 2]);
    env.backend.revokedTokens.add(w.tracking_token);

    const status = await env.sender.flush();
    expect(status).toMatchObject({ kind: "synced", pending: 0 });
    expect(env.backend.callsTo(`/workdays/${w.id}/tracking-token`)).toHaveLength(1);
    const saved = await env.db.workdays.get(w.id);
    expect(saved?.token_invalid).toBe(false);
    expect(saved?.tracking_token).not.toBe(w.tracking_token);
    expect(env.backend.points.size).toBe(2);
  });

  it("si el servidor no da un token nuevo (pasó la gracia): conserva los puntos, avisa y no insiste", async () => {
    const env = await setup();
    const w = await seedWorkday(env);
    await queue(env.db, w.id, [1]);
    env.backend.revokedTokens.add(w.tracking_token);
    env.backend.recoveryRefused = true;

    const status = await env.sender.flush();
    expect(status).toMatchObject({ kind: "error", pending: 1 });
    expect((status as { message: string }).message).toContain("no se van a poder enviar");
    expect(await env.db.workdays.get(w.id)).toMatchObject({ token_invalid: true, recovery_failed: true });
    expect(env.timers.delays()).toEqual([]);

    await env.sender.flush();
    expect(env.backend.callsTo("/tracking/batch")).toHaveLength(1);
    expect(env.backend.callsTo(`/workdays/${w.id}/tracking-token`)).toHaveLength(1);
  });

  it("una jornada marcada con token inválido en una sesión anterior se recupera al volver a enviar", async () => {
    const env = await setup();
    const w = await seedWorkday(env);
    await queue(env.db, w.id, [1]);
    env.backend.revokedTokens.add(w.tracking_token);
    await env.db.workdays.update(w.id, { token_invalid: true });
    expect(await env.sender.flush()).toMatchObject({ kind: "synced", pending: 0 });
    expect(TOKEN_INVALID_MESSAGE).toBeTruthy();
  });

  it("cada jornada usa su propio token (puntos pendientes de la jornada anterior)", async () => {
    const env = await setup();
    const old = await seedWorkday(env);
    await queue(env.db, old.id, [1]);
    await env.api.endWorkday(old.id, { ended_at: "2026-10-31T13:00:00.000Z", location: null });
    await env.db.workdays.update(old.id, { status: "FINISHED" });
    const current = await seedWorkday(env);
    await queue(env.db, current.id, [90]);

    await env.sender.flush();

    const tokens = env.backend.callsTo("/tracking/batch").map((c) => c.headers.Authorization);
    expect(tokens.sort()).toEqual([`Tracking ${current.tracking_token}`, `Tracking ${old.tracking_token}`].sort());
    expect(await env.db.points.count()).toBe(0);
  });

  it("llamadas simultáneas comparten un solo envío", async () => {
    const env = await setup();
    const w = await seedWorkday(env);
    await queue(env.db, w.id, [1]);
    await Promise.all([env.sender.flush(), env.sender.flush(), env.sender.flush()]);
    expect(env.backend.callsTo("/tracking/batch")).toHaveLength(1);
  });
});
