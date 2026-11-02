/**
 * Sirve el mapa autoalojado (`map-data/`) en `/map/` desde el mismo origen de la app (ADR-008):
 * en desarrollo y en la vista previa, con pedidos por rango (PMTiles los usa para leer solo las
 * teselas que necesita). Al compilar, copia `map-data/` a `dist/map/` para publicarlo junto a la app.
 */
import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

// Tipos mínimos (este archivo está fuera de las apps y no ve el paquete "vite").
type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
interface Server {
  middlewares: { use(handler: Handler): void };
}
interface Plugin {
  name: string;
  configResolved(config: { root: string; build: { outDir: string } }): void;
  configureServer(server: Server): void;
  configurePreviewServer(server: Server): void;
  writeBundle(): void;
}

const TYPES: Record<string, string> = {
  ".pmtiles": "application/octet-stream",
  ".pbf": "application/x-protobuf",
  ".json": "application/json",
  ".png": "image/png",
};

export function mapDataMiddleware(root: string): Handler {
  const base = resolve(root);
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? "";
    if (!url.startsWith("/map/")) return next();
    const relative = decodeURIComponent(url.slice("/map/".length).split("?")[0]!);
    const file = normalize(join(base, relative));
    if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end("No encontrado");
      return;
    }
    const { size, mtimeMs } = statSync(file);
    const etag = `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("ETag", etag);
    // Las teselas cambian solo al regenerarlas: el navegador revalida con el ETag.
    res.setHeader("Cache-Control", "no-cache");
    if (req.headers["if-none-match"] === etag && !req.headers.range) {
      res.statusCode = 304;
      res.end();
      return;
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      if (!range[1]) start = Math.max(0, start);
      end = Math.min(end, size - 1);
      if (start > end || start >= size) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${size}`);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", String(end - start + 1));
      if (req.method === "HEAD") return void res.end();
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.setHeader("Content-Length", String(size));
    if (req.method === "HEAD") return void res.end();
    createReadStream(file).pipe(res);
  };
}

export function mapDataPlugin(root: string): Plugin {
  let outDir = "dist";
  return {
    name: "routcontrol-map-data",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(mapDataMiddleware(root));
    },
    configurePreviewServer(server) {
      server.middlewares.use(mapDataMiddleware(root));
    },
    writeBundle() {
      if (existsSync(root)) cpSync(root, join(outDir, "map"), { recursive: true });
    },
  };
}
