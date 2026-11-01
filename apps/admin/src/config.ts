const env = import.meta.env;

/** Configuración del panel. La marca y las URLs salen del entorno (CLAUDE.md). */
export const config = {
  appName: env.APP_NAME || "RouteControl",
  apiBase: `${env.DEV ? "" : (env.API_URL ?? "").replace(/\/$/, "")}/api/v1`,
  mapStyleUrl: env.VITE_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/dark",
} as const;

export type AdminConfig = typeof config;
