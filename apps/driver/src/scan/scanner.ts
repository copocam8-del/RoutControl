/**
 * Escaneo de etiquetas (ADR-014).
 *
 * - Usa el `BarcodeDetector` del navegador si existe y soporta los formatos (Chrome en Android).
 * - Si no (Safari en iPhone, Firefox), usa ZXing compilado a WebAssembly (`barcode-detector`), con
 *   el `.wasm` servido desde nuestro origen (nada de CDN: sin conexión y sin bloqueadores, como el mapa).
 * - Devuelve TODOS los códigos de cada cuadro (una caja con varias etiquetas a la vista).
 */
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

/** Formatos de etiquetas de envío: lineales y 2D. */
export const FORMATS = ["code_128", "code_39", "code_93", "codabar", "ean_13", "ean_8", "itf", "upc_a", "upc_e", "qr_code", "data_matrix", "pdf417"];

export interface CodeDetector {
  detect(source: CanvasImageSource | ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}

interface DetectorCtor {
  new (options?: { formats?: string[] }): CodeDetector;
  getSupportedFormats?(): Promise<string[]>;
}

export type DetectorKind = "native" | "wasm";

/** El detector disponible en este navegador. */
export async function createDetector(): Promise<{ detector: CodeDetector; kind: DetectorKind }> {
  const Native = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (Native?.getSupportedFormats) {
    try {
      const supported = await Native.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      if (formats.includes("code_128") && formats.includes("qr_code")) return { detector: new Native({ formats }), kind: "native" };
    } catch {
      // sigue con ZXing
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? new URL(wasmUrl, globalThis.location?.href).href : prefix + path),
    },
    fireImmediately: true,
  });
  return { detector: new BarcodeDetector({ formats: FORMATS as never }) as unknown as CodeDetector, kind: "wasm" };
}

/** Normaliza lo leído: sin espacios ni caracteres de control alrededor. */
export function cleanCode(raw: string): string {
  return raw.replace(/[\u0000-\u001f]/g, "").trim();
}
