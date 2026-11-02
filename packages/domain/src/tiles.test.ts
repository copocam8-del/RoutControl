import { describe, expect, it } from "vitest";

import { boundsAround, clipBounds, countTiles, latToTileY, lngToTileX, planArea, tileKey, tilesIn } from "./tiles";

// El Obelisco (CABA): coordenadas públicas, para la cuenta de teselas.
const OBELISCO = { lat: -34.6037, lng: -58.3816 };
const AMBA = { minLat: -34.9, minLng: -58.75, maxLat: -34.45, maxLng: -58.2 };

describe("teselas para el mapa sin conexión", () => {
  it("convierte coordenadas a teselas XYZ (Web Mercator)", () => {
    expect([lngToTileX(0, 1), latToTileY(0, 1)]).toEqual([1, 1]);
    expect([lngToTileX(-180, 3), latToTileY(85, 3)]).toEqual([0, 0]);
    // El Obelisco en z15 (fórmula estándar de OpenStreetMap, "Slippy map tilenames").
    expect([lngToTileX(OBELISCO.lng, 15), latToTileY(OBELISCO.lat, 15)]).toEqual([11069, 19744]);
  });

  it("la zona incluye un margen en metros para cada lado", () => {
    const b = boundsAround([OBELISCO], 1000)!;
    expect(b.maxLat - b.minLat).toBeCloseTo(2000 / 111_320, 5);
    expect(b.maxLng - b.minLng).toBeGreaterThan(b.maxLat - b.minLat); // a esa latitud, 1 km es más grados de longitud
    expect(boundsAround([], 1000)).toBeNull();
  });

  it("cuenta y lista las mismas teselas, sin repetir", () => {
    const b = boundsAround([OBELISCO, { lat: -34.62, lng: -58.4 }], 500)!;
    const tiles = tilesIn(b, 10, 15);
    expect(tiles).toHaveLength(countTiles(b, 10, 15));
    expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length);
  });

  it("baja el zoom máximo hasta entrar en el límite, y recorta al mapa", () => {
    const far = [{ lat: -34.5, lng: -58.7 }, { lat: -34.85, lng: -58.25 }]; // AMBA de punta a punta
    const plan = planArea(far, { marginM: 1000, minZoom: 0, maxZoom: 15, maxTiles: 1000 })!;
    expect(plan.maxZoom).toBeLessThan(15);
    expect(plan.tiles.length).toBeLessThanOrEqual(1000);
    const near = planArea([OBELISCO], { marginM: 1000, minZoom: 0, maxZoom: 15, maxTiles: 3000 })!;
    expect(near.maxZoom).toBe(15);
    // Un punto fuera del mapa (Córdoba) no tiene nada que bajar.
    expect(planArea([{ lat: -31.42, lng: -64.18 }], { marginM: 1000, minZoom: 0, maxZoom: 15, maxTiles: 3000, limit: AMBA })).toBeNull();
    expect(clipBounds(boundsAround([OBELISCO], 100_000)!, AMBA)).toEqual(AMBA);
  });
});
