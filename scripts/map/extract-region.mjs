#!/usr/bin/env node
/**
 * Recorta una zona de un mapa PMTiles remoto (por ejemplo, el build diario de OpenStreetMap de
 * Protomaps) y escribe un PMTiles v3 propio para servirlo desde nuestro origen (ADR-008, §5.5).
 *
 * Usa solo la librería `pmtiles` (la misma que lee el mapa en las apps) y Node: baja cada tesela
 * de la zona con pedidos por rango y arma el archivo según la especificación v3
 * (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md).
 *
 *   node scripts/map/extract-region.mjs --source https://build.protomaps.com/20261031.pmtiles \
 *     --bbox -58.75,-34.90,-58.20,-34.45 --maxzoom 15 --out map-data/amba.pmtiles
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";

import { PMTiles, zxyToTileId } from "pmtiles";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
const source = args.source;
const [west, south, east, north] = (args.bbox ?? "").split(",").map(Number);
const minZoom = Number(args.minzoom ?? 0);
const maxZoom = Number(args.maxzoom ?? 15);
const out = args.out;
const concurrency = Number(args.concurrency ?? 16);
if (!source || !out || [west, south, east, north].some((v) => !Number.isFinite(v))) {
  console.error("Uso: --source <url.pmtiles> --bbox oeste,sur,este,norte [--minzoom 0] [--maxzoom 15] --out <archivo>");
  process.exit(2);
}

// --- Teselas de la zona -------------------------------------------------------------------------
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const wanted = [];
for (let z = minZoom; z <= maxZoom; z++) {
  const [x0, x1] = [lon2x(west, z), lon2x(east, z)];
  const [y0, y1] = [lat2y(north, z), lat2y(south, z)];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) wanted.push({ z, x, y, id: zxyToTileId(z, x, y) });
}
wanted.sort((a, b) => a.id - b.id);
console.log(`Zona ${args.bbox}, zoom ${minZoom}–${maxZoom}: ${wanted.length} teselas.`);

// --- Descarga -------------------------------------------------------------------------------------
const archive = new PMTiles(source);
const srcHeader = await archive.getHeader();
if (srcHeader.tileType !== 1) throw new Error(`Se esperaban teselas vectoriales (MVT); el origen tiene tipo ${srcHeader.tileType}`);
const metadata = await archive.getMetadata();

const tiles = new Map(); // id -> Uint8Array (sin comprimir)
let done = 0;
async function worker(queue) {
  for (let t = queue.shift(); t; t = queue.shift()) {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await archive.getZxy(t.z, t.x, t.y);
        if (res?.data) tiles.set(t.id, new Uint8Array(res.data));
        break;
      } catch (error) {
        if (attempt >= 4) throw error;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    done += 1;
    if (done % 250 === 0) console.log(`  ${done}/${wanted.length}`);
  }
}
const queue = [...wanted];
await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));
console.log(`Bajadas ${tiles.size} teselas con datos.`);

// --- Escritura PMTiles v3 -------------------------------------------------------------------------
const chunks = [];
let dataLength = 0;
const byHash = new Map(); // contenido repetido (agua, campo): se guarda una sola vez
const entries = [];
let contents = 0;
for (const id of [...tiles.keys()].sort((a, b) => a - b)) {
  const compressed = gzipSync(tiles.get(id), { level: 9 });
  const hash = createHash("sha256").update(compressed).digest("hex");
  let offset = byHash.get(hash);
  if (offset === undefined) {
    offset = dataLength;
    byHash.set(hash, offset);
    chunks.push(compressed);
    dataLength += compressed.length;
    contents += 1;
  }
  const last = entries.at(-1);
  if (last && last.offset === offset && last.tileId + last.runLength === id) last.runLength += 1;
  else entries.push({ tileId: id, offset, length: compressed.length, runLength: 1 });
}

function varint(n, buf) {
  while (n >= 0x80) {
    buf.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  buf.push(n);
}

function serializeDirectory(list) {
  const buf = [];
  varint(list.length, buf);
  let lastId = 0;
  for (const e of list) {
    varint(e.tileId - lastId, buf);
    lastId = e.tileId;
  }
  for (const e of list) varint(e.runLength, buf);
  for (const e of list) varint(e.length, buf);
  list.forEach((e, i) => {
    const prev = list[i - 1];
    if (i > 0 && e.offset === prev.offset + prev.length) varint(0, buf);
    else varint(e.offset + 1, buf);
  });
  return gzipSync(Uint8Array.from(buf), { level: 9 });
}

// El encabezado y el directorio raíz tienen que entrar en los primeros 16 KiB.
let root = serializeDirectory(entries);
let leaves = Buffer.alloc(0);
for (let leafSize = 4096; 127 + root.length > 16384; leafSize *= 2) {
  const rootEntries = [];
  const parts = [];
  let offset = 0;
  for (let i = 0; i < entries.length; i += leafSize) {
    const leaf = serializeDirectory(entries.slice(i, i + leafSize));
    rootEntries.push({ tileId: entries[i].tileId, offset, length: leaf.length, runLength: 0 });
    parts.push(leaf);
    offset += leaf.length;
  }
  root = serializeDirectory(rootEntries);
  leaves = Buffer.concat(parts);
}

const meta = gzipSync(Buffer.from(JSON.stringify({ ...metadata, description: `Recorte ${args.bbox} (z${minZoom}-${maxZoom}) de ${source}` })));
const header = Buffer.alloc(127);
header.write("PMTiles", 0, "ascii");
header.writeUInt8(3, 7);
const rootOffset = 127;
const metaOffset = rootOffset + root.length;
const leafOffset = metaOffset + meta.length;
const dataOffset = leafOffset + leaves.length;
const u64 = (value, at) => header.writeBigUInt64LE(BigInt(value), at);
u64(rootOffset, 8);
u64(root.length, 16);
u64(metaOffset, 24);
u64(meta.length, 32);
u64(leafOffset, 40);
u64(leaves.length, 48);
u64(dataOffset, 56);
u64(dataLength, 64);
u64(tiles.size, 72); // teselas con dirección
u64(entries.length, 80); // entradas de directorio
u64(contents, 88); // contenidos distintos
header.writeUInt8(1, 96); // agrupado (clustered)
header.writeUInt8(2, 97); // compresión interna: gzip
header.writeUInt8(2, 98); // compresión de teselas: gzip
header.writeUInt8(1, 99); // tipo: MVT
header.writeUInt8(minZoom, 100);
header.writeUInt8(maxZoom, 101);
const e7 = (v) => Math.round(v * 1e7);
header.writeInt32LE(e7(west), 102);
header.writeInt32LE(e7(south), 106);
header.writeInt32LE(e7(east), 110);
header.writeInt32LE(e7(north), 114);
header.writeUInt8(Math.min(maxZoom, 12), 118);
header.writeInt32LE(e7((west + east) / 2), 119);
header.writeInt32LE(e7((south + north) / 2), 123);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, root, meta, leaves, ...chunks]));
console.log(`Escrito ${out}: ${(dataOffset + dataLength) / 1e6} MB, ${entries.length} entradas, ${contents} teselas distintas.`);
