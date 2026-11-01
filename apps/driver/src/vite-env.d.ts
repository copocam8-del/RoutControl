/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Nombre provisorio del producto (CLAUDE.md: nunca fijo en el código). */
  readonly APP_NAME?: string;
  /** Producción: origen de la API (https://api.<dominio>). En desarrollo se usa el proxy de Vite. */
  readonly API_URL?: string;
  readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
