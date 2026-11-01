/**
 * UUIDv7 (RFC 9562): los ids que genera el teléfono (§5.2). Llevan la hora en los primeros 48 bits,
 * así se ordenan por momento de creación y los índices del servidor no se fragmentan.
 */
export function uuidv7(now: number = Date.now(), random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = fillRandom): string {
  const bytes = random(new Uint8Array(16));
  const ms = BigInt(now);
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // versión 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variante RFC
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fillRandom(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Milisegundos codificados en un UUIDv7. */
export function uuidv7Timestamp(id: string): number {
  return parseInt(id.replace(/-/g, "").slice(0, 12), 16);
}
