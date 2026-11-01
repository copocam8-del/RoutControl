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
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
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
