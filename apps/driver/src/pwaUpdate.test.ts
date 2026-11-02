// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { UpdateManager } from "./pwaUpdate";

describe("versión nueva de la PWA", () => {
  it("sin jornada en curso se instala sola (no queda la versión vieja andando, como pasó en el iPhone)", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const updates = new UpdateManager(() => true);
    updates.onNeedRefresh(apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(updates.getState().available).toBe(false);
  });

  it("con la jornada en curso no recarga: avisa, y se instala sola al finalizar", () => {
    let busy = true;
    const apply = vi.fn().mockResolvedValue(undefined);
    const updates = new UpdateManager(() => !busy);
    updates.onNeedRefresh(apply);
    expect(apply).not.toHaveBeenCalled();
    expect(updates.getState().available).toBe(true);
    updates.maybeUpdate(); // sigue en jornada
    expect(apply).not.toHaveBeenCalled();
    busy = false;
    updates.maybeUpdate();
    expect(apply).toHaveBeenCalledOnce();
  });

  it("'Actualizar' instala aunque la jornada esté en curso (lo decide el repartidor)", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const updates = new UpdateManager(() => false);
    updates.onNeedRefresh(apply);
    await updates.update();
    expect(apply).toHaveBeenCalledOnce();
  });

  it("la app conecta la jornada: iniciar bloquea la actualización automática", async () => {
    const { setup } = await import("./test/helpers");
    const { createApp } = await import("./app");
    const env = await setup();
    const app = createApp({ db: env.db, api: env.api, device: env.device });
    await app.workday.resume();
    await app.workday.start();
    const apply = vi.fn().mockResolvedValue(undefined);
    app.updates.onNeedRefresh(apply);
    expect(apply).not.toHaveBeenCalled();
    await app.workday.end();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    app.workday.dispose();
  });
});
