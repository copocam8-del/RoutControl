// @vitest-environment jsdom
/** Mapa autoalojado (ADR-008): nada de otros dominios, errores con detalle y "sin conexión". */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { mapDataMiddleware } from "../../../../scripts/map/vite-plugin";
import {
  classifyFailure,
  clearMapErrors,
  describeResource,
  errorDetails,
  getMapErrors,
  recordMapError,
  subscribeMapErrors,
} from "./diagnostics";
import { buildStyle, DEFAULT_MAP_SOURCE } from "./style";

describe("estilo del mapa: todo desde nuestro origen", () => {
  it("teselas PMTiles, fuentes e íconos salen del mismo origen que la app", () => {
    const style = buildStyle(DEFAULT_MAP_SOURCE);
    const origin = window.location.origin;
    const source = style.sources.protomaps as { url: string; attribution: string };
    expect(source.url).toBe(`pmtiles://${origin}/map/amba.pmtiles`);
    expect(style.glyphs).toBe(`${origin}/map/fonts/{fontstack}/{range}.pbf`);
    expect(style.sprite).toBe(`${origin}/map/sprites/dark`);
    // Ningún otro dominio en todo el estilo (OpenFreeMap, Protomaps, Google…), salvo el enlace de la licencia.
    const urls = JSON.stringify(style).match(/https?:\/\/[^"\\ ]+/g) ?? [];
    expect(urls.filter((u) => !u.startsWith(origin) && !u.startsWith("https://openstreetmap.org/copyright"))).toEqual([]);
    expect(source.attribution).toContain("OpenStreetMap");
  });

  it("las fuentes que pide el estilo están en map-data/fonts", async () => {
    const { readdirSync } = await import("node:fs");
    const available = new Set(readdirSync(join(process.cwd(), "../../map-data/fonts")));
    const fonts = new Set(
      JSON.stringify(buildStyle(DEFAULT_MAP_SOURCE).layers)
        .match(/Noto Sans[^"]*/g)
        ?.filter((f) => !f.includes("Devanagari")), // solo para hindi
    );
    expect([...fonts].filter((f) => !available.has(f))).toEqual([]);
  });
});

describe("errores del mapa para Diagnóstico", () => {
  beforeEach(() => clearMapErrors());

  it("se guardan con mensaje, recurso y URL, y avisan a la pantalla", () => {
    const listener = vi.fn();
    const off = subscribeMapErrors(listener);
    recordMapError({ at: 1, kind: "failed", resource: "worker de MapLibre", message: "404", url: "https://x/assets/w.mjs", status: 404 });
    expect(getMapErrors()[0]).toMatchObject({ resource: "worker de MapLibre", url: "https://x/assets/w.mjs", status: 404 });
    expect(listener).toHaveBeenCalled();
    off();
  });

  it("guarda los últimos 10, el más nuevo primero", () => {
    for (let i = 0; i < 12; i++) recordMapError({ at: i, kind: "failed", resource: "mapa", message: `e${i}`, url: null, status: null });
    expect(getMapErrors()).toHaveLength(10);
    expect(getMapErrors()[0]!.message).toBe("e11");
  });

  it.each([
    ["https://app/map/amba.pmtiles", "teselas (PMTiles)"],
    ["pmtiles://https://app/map/amba.pmtiles/12/1/2", "teselas (PMTiles)"],
    ["https://app/map/fonts/Noto%20Sans%20Regular/0-255.pbf", "fuentes del mapa"],
    ["https://app/map/sprites/dark@2x.png", "íconos del mapa"],
    ["https://app/assets/maplibre-gl-worker-abc.mjs", "worker de MapLibre"],
    [null, "mapa"],
  ])("%s → %s", (url, resource) => expect(describeResource(url)).toBe(resource));

  it("saca la URL y el código de un error de MapLibre (AJAXError)", () => {
    const ajax = Object.assign(new Error("Forbidden"), { name: "AJAXError", status: 403, url: "https://app/map/amba.pmtiles" });
    expect(errorDetails(ajax)).toEqual({ message: "AJAXError: Forbidden", url: "https://app/map/amba.pmtiles", status: 403 });
    expect(errorDetails(new Error("Failed to fetch https://app/map/sprites/dark.json")).url).toBe("https://app/map/sprites/dark.json");
  });
});

describe("sin conexión o no se pudo cargar", () => {
  it("el teléfono dice que no hay red: sin conexión", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(await classifyFailure(new TypeError("Failed to fetch"), null, "/map/amba.pmtiles")).toBe("offline");
  });

  it("un error de red y nuestro propio servidor tampoco responde: sin conexión", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await classifyFailure(new TypeError("Failed to fetch"), null, "/map/amba.pmtiles")).toBe("offline");
    vi.unstubAllGlobals();
  });

  it("un error de red pero el servidor responde (bloqueador, archivo roto): no se pudo cargar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    expect(await classifyFailure(new TypeError("Failed to fetch"), 0, "/map/amba.pmtiles")).toBe("failed");
    vi.unstubAllGlobals();
  });

  it("un error del servidor (404, 500) no es falta de conexión", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await classifyFailure(Object.assign(new Error("Not Found"), { status: 404 }), 404, "/map/amba.pmtiles")).toBe("failed");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("servidor de /map/ (desarrollo y vista previa)", () => {
  let server: Server;
  let base: string;
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), "rc-map-"));
    writeFileSync(join(root, "amba.pmtiles"), bytes);
    mkdirSync(join(root, "fonts"));
    writeFileSync(join(root, "fonts", "a.pbf"), "x");
    const handler = mapDataMiddleware(root);
    server = createServer((req, res) =>
      handler(req, res, () => {
        res.statusCode = 418;
        res.end("siguiente");
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("responde pedidos por rango (los usa PMTiles)", async () => {
    const res = await fetch(`${base}/map/amba.pmtiles`, { headers: { Range: "bytes=10-19" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes.subarray(10, 20));
  });

  it("el archivo entero, con tipo y Accept-Ranges", async () => {
    const res = await fetch(`${base}/map/fonts/a.pbf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-protobuf");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  it("404 si no existe, y no deja salir de la carpeta", async () => {
    expect((await fetch(`${base}/map/nada.pmtiles`)).status).toBe(404);
    expect((await fetch(`${base}/map/..%2f..%2fetc%2fpasswd`)).status).toBe(404);
  });

  it("lo que no es /map/ sigue de largo", async () => {
    expect((await fetch(`${base}/api/v1/`)).status).toBe(418);
  });
});
