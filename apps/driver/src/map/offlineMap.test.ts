/** Mapa sin conexión (ADR-018): qué se guarda, qué se reemplaza y qué pasa sin señal. */
import { describe, expect, it, vi } from "vitest";

import { config } from "../config";
import { getMeta } from "../store/db";
import { freshDb } from "../test/helpers";
import { testPackage } from "../test/packages";
import { formatBytes, MAP_LIMIT, OfflineMap, type OfflineMapInfo } from "./offlineMap";

const at = (lat: number, lng: number) => testPackage({ address: { ...testPackage().address, location: { lat, lng } } });

function fakeMapModule(opts: { failWith?: Error } = {}) {
  return {
    downloadTiles: vi.fn(async (_url: string, tiles: readonly { z: number; x: number; y: number }[], put: (k: string, d: Uint8Array) => Promise<void>) => {
      if (opts.failWith) throw opts.failWith;
      for (const t of tiles) await put(`${t.z}/${t.x}/${t.y}`, new Uint8Array([t.z]));
      return { tileJson: { minzoom: 0, maxzoom: 15, bounds: [MAP_LIMIT.minLng, MAP_LIMIT.minLat, MAP_LIMIT.maxLng, MAP_LIMIT.maxLat] as [number, number, number, number] }, saved: tiles.length, bytes: tiles.length };
    }),
    preloadMapCode: vi.fn(async () => {}),
    setOfflineTiles: vi.fn(),
  };
}

function make(map = fakeMapModule()) {
  const db = freshDb();
  const fetchImpl = vi.fn(async () => new Response("")) as unknown as typeof fetch;
  const offline = new OfflineMap({ db, config, loadMap: async () => map, fetchImpl, now: () => new Date("2026-11-02T12:00:00Z") });
  return { db, offline, map, fetchImpl };
}

describe("mapa sin conexión", () => {
  it("guarda las teselas de la zona, el TileJSON y deja en caché fuentes, íconos y el código del mapa", async () => {
    const { db, offline, map, fetchImpl } = make();
    const packages = [at(-34.6037, -58.3816), at(-34.61, -58.39)];
    await offline.save(packages);
    const state = offline.getState();
    expect(state.status).toBe("idle");
    const info = state.info!;
    expect(info.packages).toBe(2);
    expect(info.max_zoom).toBe(15);
    expect(await db.mapTiles.count()).toBe(info.tiles);
    expect((await getMeta<OfflineMapInfo>(db, "offline_map"))!.tile_json.maxzoom).toBe(15);
    // El protocolo del mapa ya lee lo guardado.
    expect(map.setOfflineTiles).toHaveBeenCalled();
    const store = offline.store();
    expect(Array.from((await store.getTile("15/11069/19744"))!)).toEqual([15]);
    expect(await store.getTile("15/1/1")).toBeUndefined();
    const urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/map/fonts/Noto%20Sans%20Regular/0-255.pbf");
    expect(urls).toContain("/map/sprites/light@2x.png");
    expect(map.preloadMapCode).toHaveBeenCalled();
  });

  it("avisa cuando un paquete queda fuera de la zona, y al actualizar borra lo que ya no entra", async () => {
    const { db, offline } = make();
    await offline.save([at(-34.6037, -58.3816)]);
    const first = offline.getState().info!;
    expect(offline.outside([at(-34.6037, -58.3816)])).toBe(0);
    const moved = [at(-34.8, -58.3)]; // otra punta del AMBA
    expect(offline.outside(moved)).toBe(1);
    await offline.save(moved);
    const second = offline.getState().info!;
    expect(offline.outside(moved)).toBe(0);
    expect(await db.mapTiles.count()).toBe(second.tiles);
    expect(await db.mapTiles.get("15/11069/19744")).toBeUndefined(); // la zona anterior se borró
    expect(second.bounds).not.toEqual(first.bounds);
    // Fuera del mapa (Córdoba) no cuenta como "afuera de la zona": ahí no hay mapa.
    expect(offline.outside([at(-31.42, -64.18)])).toBe(0);
  });

  it("sin direcciones ubicadas no baja nada; sin señal, lo dice y conserva lo guardado", async () => {
    const { offline } = make();
    await offline.save([testPackage({ address: { ...testPackage().address, location: null } })]);
    expect(offline.getState()).toMatchObject({ status: "error", error: "Ningún paquete tiene una dirección ubicada en el mapa." });

    const ok = make();
    await ok.offline.save([at(-34.6037, -58.3816)]);
    const saved = ok.offline.getState().info;
    const failing = new OfflineMap({ db: ok.db, config, loadMap: async () => fakeMapModule({ failWith: new TypeError("Failed to fetch") }) });
    await failing.init();
    await failing.save([at(-34.7, -58.4)]);
    expect(failing.getState()).toMatchObject({ status: "error", error: "Sin conexión: probá de nuevo con señal.", info: saved });
    expect(await ok.db.mapTiles.count()).toBe(saved!.tiles);
  });

  it("se puede borrar", async () => {
    const { db, offline } = make();
    await offline.save([at(-34.6037, -58.3816)]);
    await offline.clear();
    expect(await db.mapTiles.count()).toBe(0);
    expect(offline.getState().info).toBeNull();
  });

  it("tamaños legibles", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.45 * 1024 * 1024)).toBe("3,5 MB");
  });
});
