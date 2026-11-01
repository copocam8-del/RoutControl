/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Nombre provisorio del producto (CLAUDE.md: nunca fijo en el código). */
  readonly APP_NAME?: string;
  /** Producción: origen de la API (https://api.<dominio>). En desarrollo se usa el proxy de Vite. */
  readonly API_URL?: string;
  readonly VITE_API_PROXY_TARGET?: string;
  /** Estilo de mapa de MapLibre (URL de un style.json). */
  readonly VITE_MAP_STYLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
