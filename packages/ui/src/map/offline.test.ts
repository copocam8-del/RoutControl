import { describe, expect, it, vi } from "vitest";

import { downloadTiles, offlineFirst, type OfflineTileStore, type PMTilesLike } from "./offline";

const URL_BASE = "pmtiles://https://app.test/map/amba.pmtiles";

function memoryStore(tiles: Record<string, Uint8Array>, tileJson?: Awaited<ReturnType<OfflineTileStore["getTileJson"]>>): OfflineTileStore {
  return { getTile: async (k) => tiles[k], getTileJson: async () => tileJson };
}

describe("protocolo pmtiles con lo guardado primero", () => {
  it("una tesela guardada no va a la red; una que falta, sí", async () => {
    const online = vi.fn(async () => ({ data: new Uint8Array([9]) }));
    const handler = offlineFirst(online, () => memoryStore({ "15/11069/19744": new Uint8Array([1, 2]) }));
    const abort = new AbortController();
    expect((await handler({ url: `${URL_BASE}/15/11069/19744` }, abort)).data).toEqual(new Uint8Array([1, 2]));
    expect(online).not.toHaveBeenCalled();
    expect((await handler({ url: `${URL_BASE}/15/11070/19744` }, abort)).data).toEqual(new Uint8Array([9]));
    expect(online).toHaveBeenCalledTimes(1);
  });

  it("sin red, los límites del mapa (TileJSON) salen de lo guardado", async () => {
    const online = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const saved = { minzoom: 0, maxzoom: 15, bounds: [-58.75, -34.9, -58.2, -34.45] as [number, number, number, number] };
    const handler = offlineFirst(online, () => memoryStore({}, saved));
    const res = await handler({ url: URL_BASE, type: "json" }, new AbortController());
    expect(res.data).toEqual({ ...saved, tiles: [`${URL_BASE}/{z}/{x}/{y}`] });
    // Sin nada guardado, el error es el de la red (el mapa muestra "sin conexión").
    await expect(offlineFirst(online, () => memoryStore({}))({ url: URL_BASE, type: "json" }, new AbortController())).rejects.toThrow("Failed to fetch");
    await expect(offlineFirst(online, () => null)({ url: `${URL_BASE}/1/0/0` }, new AbortController())).rejects.toThrow();
  });
});

describe("descarga de la zona", () => {
  it("guarda las teselas que existen, saltea las vacías e informa el avance", async () => {
    const archive: PMTilesLike = {
      getHeader: async () => ({ minZoom: 0, maxZoom: 15, minLon: -58.75, minLat: -34.9, maxLon: -58.2, maxLat: -34.45 }),
      getZxy: async (z, x) => (x % 2 === 0 ? { data: new Uint8Array(z + 1).buffer } : undefined),
    };
    const put = vi.fn(async (_key: string, _data: Uint8Array) => {});
    const progress: number[] = [];
    const tiles = [0, 1, 2, 3].map((x) => ({ z: 3, x, y: 4 }));
    const result = await downloadTiles("x", tiles, put, { pmtiles: archive, onProgress: (p) => progress.push(p.done), concurrency: 2 });
    expect(result).toEqual({ tileJson: { minzoom: 0, maxzoom: 15, bounds: [-58.75, -34.9, -58.2, -34.45] }, saved: 2, bytes: 8 });
    expect(put.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["3/0/4", "3/2/4"]));
    expect(progress.sort()).toEqual([1, 2, 3, 4]);
  });

  it("se puede cancelar", async () => {
    const archive: PMTilesLike = { getHeader: async () => ({ minZoom: 0, maxZoom: 1, minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 }), getZxy: async () => undefined };
    const abort = new AbortController();
    abort.abort();
    await expect(downloadTiles("x", [{ z: 0, x: 0, y: 0 }], async () => {}, { pmtiles: archive, signal: abort.signal })).rejects.toThrow();
  });
});
