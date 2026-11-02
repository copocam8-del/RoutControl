/**
 * Foto de la entrega: se achica en el teléfono antes de guardarla (lado mayor 1600 px, JPEG 0,8).
 * Una foto de cámara pesa 3–5 MB; achicada, unos 300 KB: menos memoria en el teléfono y menos
 * datos móviles al subirla. Si el navegador no puede achicarla, se guarda tal cual.
 */
export const MAX_SIDE = 1600;

export async function preparePhoto(file: Blob): Promise<{ data: ArrayBuffer; type: string }> {
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") throw new Error("sin canvas");
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("sin contexto 2d");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob) throw new Error("toBlob falló");
    return { data: await blob.arrayBuffer(), type: "image/jpeg" };
  } catch {
    return { data: await file.arrayBuffer(), type: file.type || "image/jpeg" };
  }
}
