/** "Mis paquetes", la visita y la cola de envío, contra el backend falso (ADR-013). */
import { describe, expect, it } from "vitest";

import { Deliveries } from "./deliveries";
import { Outbox } from "./outbox";
import { manualTimers, settle, setup } from "../test/helpers";
import { testPackage } from "../test/packages";

async function env() {
  const base = await setup();
  const timers = manualTimers();
  const outbox = new Outbox(base.db, base.api, { timers, random: () => 0.5 });
  const deliveries = new Deliveries({ db: base.db, api: base.api, outbox, device: base.device, workday: base.workday });
  return { ...base, outbox, deliveries, timers };
}

const PHOTO = { data: new Uint8Array([1, 2, 3]).buffer, type: "image/jpeg" };

describe("Mis paquetes", () => {
  it("carga la lista y la guarda en el teléfono para verla sin conexión", async () => {
    const e = await env();
    e.backend.packages = [testPackage(), testPackage()];
    await e.deliveries.load();
    expect(e.deliveries.getState()).toMatchObject({ status: "ready", offline: false });
    expect(await e.db.packages.count()).toBe(2);

    e.backend.online = false;
    const again = new Deliveries({ db: e.db, api: e.api, outbox: e.outbox, device: e.device, workday: e.workday });
    await again.load();
    expect(again.getState()).toMatchObject({ status: "ready", offline: true });
    expect(again.getState().packages).toHaveLength(2);
  });

  it("sin conexión y sin nada guardado: error claro", async () => {
    const e = await env();
    e.backend.online = false;
    await e.deliveries.load();
    expect(e.deliveries.getState().status).toBe("error");
  });
});

describe("visita", () => {
  it("hace falta la jornada iniciada", async () => {
    const e = await env();
    e.backend.packages = [testPackage()];
    await e.workday.resume();
    await e.deliveries.load();
    await expect(e.deliveries.startVisit(e.deliveries.getState().packages[0]!)).rejects.toThrow("Iniciá la jornada");
  });

  it("entregado con foto: se guarda en el teléfono, se envía en orden y el paquete queda entregado", async () => {
    const e = await env();
    const pkg = testPackage();
    e.backend.packages = [pkg];
    await e.workday.resume();
    await e.workday.start();
    await e.deliveries.load();

    const visit = await e.deliveries.startVisit(e.deliveries.getState().packages[0]!);
    expect(await e.db.meta.get("activeVisit")).toBeTruthy(); // sobrevive a cerrar la app
    await e.deliveries.finishVisit({ outcome: "DELIVERED", photo: PHOTO });
    expect(e.deliveries.getState().packages[0]!.status).toBe("DELIVERED");
    expect(e.deliveries.getState().activeVisit).toBeNull();
    await e.outbox.flush();

    expect(e.backend.visits.get(visit.id)).toMatchObject({ outcome: "DELIVERED", package_id: pkg.id, workday_id: expect.any(String) });
    const [photo] = [...e.backend.evidence.values()];
    expect(photo).toMatchObject({ visit_id: visit.id, package_id: pkg.id, reason: "entrega", file: { size: 3, type: "image/jpeg" } });
    const order = e.backend.calls.filter((c) => ["/visits", "/evidence"].includes(c.path)).map((c) => c.path);
    expect(order).toEqual(["/visits", "/evidence"]); // la foto, después de su visita
    expect(await e.db.outbox.count()).toBe(0);
    e.workday.dispose();
  });

  it("sin señal: queda en el teléfono, el estado se ve igual, y se envía al volver la señal (sin duplicar)", async () => {
    const e = await env();
    e.backend.packages = [testPackage()];
    await e.workday.resume();
    await e.workday.start();
    await e.deliveries.load();
    e.backend.online = false;
    await e.deliveries.startVisit(e.deliveries.getState().packages[0]!);
    await e.deliveries.finishVisit({ outcome: "NO_ANSWER", notes: "Toqué timbre dos veces" });
    await e.outbox.flush();
    expect(e.outbox.getStatus()).toMatchObject({ pending: 1, failed: 0 });
    expect(e.timers.delays().length).toBe(1); // reintento programado

    // La lista recargada (sin conexión, desde el teléfono) mantiene el resultado local.
    await e.deliveries.load();
    expect(e.deliveries.getState().packages[0]!.status).toBe("FAILED");

    e.backend.online = true;
    e.timers.runAll();
    await settle();
    expect(e.backend.visits.size).toBe(1);
    expect(e.outbox.getStatus().pending).toBe(0);
    e.workday.dispose();
  });

  it("un rechazo que reintentar no arregla queda marcado y no frena lo demás", async () => {
    const e = await env();
    const gone = testPackage();
    const ok = testPackage();
    e.backend.packages = [gone, ok];
    await e.workday.resume();
    await e.workday.start();
    await e.deliveries.load();
    e.backend.packages = [ok]; // al primero lo desasignaron mientras tanto: el servidor dirá 404
    await e.deliveries.startVisit(e.deliveries.getState().packages[0]!);
    await e.deliveries.finishVisit({ outcome: "DELIVERED" });
    await e.deliveries.startVisit(e.deliveries.getState().packages[1]!);
    await e.deliveries.finishVisit({ outcome: "DELIVERED" });
    await e.outbox.flush();
    expect(e.outbox.getStatus()).toMatchObject({ pending: 0, failed: 1 });
    expect((await e.outbox.failedItems())[0]!.failed).toMatchObject({ status: 404 });
    expect(e.backend.visits.size).toBe(1);
    e.workday.dispose();
  });

  it("una sola visita en curso a la vez", async () => {
    const e = await env();
    e.backend.packages = [testPackage(), testPackage()];
    await e.workday.resume();
    await e.workday.start();
    await e.deliveries.load();
    const [a, b] = e.deliveries.getState().packages;
    await e.deliveries.startVisit(a!);
    await expect(e.deliveries.startVisit(b!)).rejects.toThrow("visita en curso");
    await e.deliveries.cancelVisit();
    await e.deliveries.startVisit(b!);
    e.workday.dispose();
  });

  it("Llamar y WhatsApp quedan registrados", async () => {
    const e = await env();
    e.backend.packages = [testPackage()];
    await e.deliveries.load();
    await e.deliveries.logContact(e.deliveries.getState().packages[0]!, "WHATSAPP");
    await e.outbox.flush();
    expect([...e.backend.communications.values()][0]).toMatchObject({ channel: "WHATSAPP" });
  });
});
