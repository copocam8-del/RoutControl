#!/usr/bin/env node
/** Verifica un PMTiles local: encabezado legible y teselas iguales a las del origen. */
import { openSync, readSync } from "node:fs";

import { PMTiles } from "pmtiles";

const [file, source, ...zxys] = process.argv.slice(2);
const fd = openSync(file, "r");
const local = new PMTiles({
  getKey: () => file,
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) };
  },
});
const h = await local.getHeader();
console.log(`zoom ${h.minZoom}-${h.maxZoom}, ${h.numAddressedTiles} teselas, compresión ${h.tileCompression}`);
const remote = new PMTiles(source);
let ok = 0;
for (const zxy of zxys) {
  const [z, x, y] = zxy.split("/").map(Number);
  const [a, b] = await Promise.all([local.getZxy(z, x, y), remote.getZxy(z, x, y)]);
  const same = a && b && Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0;
  console.log(`${zxy}: ${same ? "igual" : "DISTINTA"} (${a?.data.byteLength} bytes)`);
  if (same) ok += 1;
}
process.exit(ok === zxys.length ? 0 : 1);
