const env = import.meta.env;

/** Configuración de la app. La marca y las URLs salen del entorno (CLAUDE.md). */
export const config = {
  appName: env.APP_NAME || "RouteControl",
  /** En desarrollo, mismo origen (proxy de Vite). En producción, https://api.<dominio>. */
  apiBase: `${env.DEV ? "" : (env.API_URL ?? "").replace(/\/$/, "")}/api/v1`,
  appVersion: "0.1.0-etapa0",
  /**
   * Mapa autoalojado (ADR-008): teselas de OpenStreetMap en PMTiles, fuentes e íconos, todo desde
   * nuestro origen en /map/. Nada de otros dominios (bloqueadores, sin conexión).
   */
  map: { pmtiles: env.VITE_MAP_PMTILES_URL || "/map/amba.pmtiles", assets: env.VITE_MAP_ASSETS_URL || "/map" },
  tracking: {
    /** Con la app abierta: guardar un punto cada tanto tiempo... */
    minIntervalMs: 15_000,
    /** ...o cuando se movió esta distancia, lo que pase primero. */
    minDistanceM: 25,
    /** Velocidad (m/s) a partir de la cual el punto se marca "en movimiento". */
    movingSpeedMs: 0.8,
    /** Fijaciones más viejas que esto respecto de "ahora" no se usan para eventos. */
    maxEventFixAgeMs: 120_000,
  },
  sync: {
    batchSize: 50,
    /** Envío periódico mientras la app está abierta. */
    periodicFlushMs: 30_000,
    /** Pequeña espera después de cada punto nuevo, para juntar varios en un lote. */
    debounceMs: 2_000,
  },
} as const;

export type AppConfig = typeof config;
