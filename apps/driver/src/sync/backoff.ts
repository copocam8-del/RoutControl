/** Espera creciente entre reintentos (§5.2): 5 s, 15 s, 1 min, 5 min, 15 min y después 30 min. */
export const BACKOFF_STEPS_MS = [5_000, 15_000, 60_000, 300_000, 900_000, 1_800_000] as const;

/**
 * Espera para el intento número `attempt` (0 = primer reintento), con ±20 % de variación para
 * que muchos teléfonos que recuperan señal a la vez no reintenten todos juntos.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = BACKOFF_STEPS_MS[Math.min(Math.max(attempt, 0), BACKOFF_STEPS_MS.length - 1)]!;
  const jitter = 0.8 + random() * 0.4;
  return Math.round(base * jitter);
}
