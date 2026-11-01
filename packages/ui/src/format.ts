/** Formatos de números y fechas en español de Argentina, iguales en la PWA y en el panel. */

export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
}

/** "h:mm:ss" desde una hora de inicio (el cronómetro se calcula, no se cuenta: §4.2). */
export function formatElapsed(fromIso: string, now: number): string {
  const total = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatAgo(at: number | null, now: number): string {
  if (at === null) return "nunca";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.round(m / 60)} h`;
}

/** "Domingo 1 de noviembre" (con mayúscula inicial, como en las maquetas). */
export function formatLongDate(at: string | number | Date): string {
  const text = new Date(at).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Hoy 17:20", "Ayer 17:20" o "30/10 17:20" (para "última señal" y "última jornada"). */
export function formatDayTime(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(at)) / 86_400_000);
  const prefix = diff === 0 ? "Hoy" : diff === 1 ? "Ayer" : at.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  return `${prefix} ${formatTime(iso)}`;
}

/** Saludo según la hora del teléfono. */
export function greeting(at: number | Date = Date.now()): string {
  const h = new Date(at).getHours();
  if (h >= 5 && h < 13) return "Buen día,";
  if (h >= 13 && h < 20) return "Buenas tardes,";
  return "Buenas noches,";
}

/** Duración entre dos momentos: "8 h 28 min". */
export function formatSpan(fromIso: string, to: string | number): string {
  const end = typeof to === "number" ? to : Date.parse(to);
  return formatDuration(Math.max(0, (end - Date.parse(fromIso)) / 1000));
}
