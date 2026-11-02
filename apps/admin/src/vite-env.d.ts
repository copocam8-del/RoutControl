/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly APP_NAME?: string;
  /** Producción: origen de la API (https://api.<dominio>). En desarrollo se usa el proxy de Vite. */
  readonly API_URL?: string;
  readonly VITE_API_PROXY_TARGET?: string;
  readonly VITE_MAP_PMTILES_URL?: string;
  readonly VITE_MAP_ASSETS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
