const env = import.meta.env;

/** Configuración del panel. La marca y las URLs salen del entorno (CLAUDE.md). */
export const config = {
  appName: env.APP_NAME || "RouteControl",
  apiBase: `${env.DEV ? "" : (env.API_URL ?? "").replace(/\/$/, "")}/api/v1`,
  /**
   * Mapa autoalojado (ADR-008): teselas de OpenStreetMap en PMTiles, fuentes e íconos, todo desde
   * nuestro origen en /map/. Nada de otros dominios (bloqueadores, sin conexión).
   */
  map: { pmtiles: env.VITE_MAP_PMTILES_URL || "/map/amba.pmtiles", assets: env.VITE_MAP_ASSETS_URL || "/map" },
} as const;

export type AdminConfig = typeof config;
