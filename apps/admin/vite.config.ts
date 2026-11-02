/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import { mapDataPlugin } from "../../scripts/map/vite-plugin";

const ENV_DIR = "../.."; // el .env de la raíz del monorepo
// Variables que llegan al navegador: públicas, nunca secretos.
const ENV_PREFIX = ["VITE_", "APP_", "API_URL"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ENV_DIR, ENV_PREFIX);
  const appName = env.APP_NAME || "RouteControl";
  // Solo desarrollo: /api va por proxy a Django (mismo origen, ADR-005). En producción el panel
  // está en panel.<dominio> y la API en API_URL (api.<dominio>).
  const proxy = { "/api": { target: env.VITE_API_PROXY_TARGET || "http://localhost:8000", changeOrigin: false } };

  return {
    envDir: ENV_DIR,
    envPrefix: ENV_PREFIX,
    plugins: [
      react(),
      // Mapa autoalojado en /map/ (ADR-008).
      mapDataPlugin(fileURLToPath(new URL("../../map-data", import.meta.url))),
      { name: "routcontrol-app-name", transformIndexHtml: (html: string) => html.replace("__APP_NAME__", `${appName} · Panel`) },
    ],
    server: { port: 5174, strictPort: true, proxy, allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.app"] },
    preview: { port: 4174, strictPort: true, proxy, allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.app"] },
    test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], restoreMocks: true },
  };
});
