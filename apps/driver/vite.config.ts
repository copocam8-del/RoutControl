/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import { mapDataPlugin } from "../../scripts/map/vite-plugin";

const ENV_DIR = "../.."; // el .env de la raíz del monorepo
// Variables que llegan al código del navegador. Son públicas: nunca poner secretos con estos prefijos.
const ENV_PREFIX = ["VITE_", "APP_", "API_URL"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ENV_DIR, ENV_PREFIX);
  const appName = env.APP_NAME || "RouteControl";
  // Solo desarrollo: Vite reenvía /api a Django, así la PWA y la API comparten origen (ADR-005).
  // En producción la API vive en su propio subdominio (API_URL) y no hay proxy.
  const proxy = {
    "/api": {
      target: env.VITE_API_PROXY_TARGET || "http://localhost:8000",
      changeOrigin: false, // conserva Host: Django compara el Origin contra el host real (ADR-005)
    },
  };

  return {
    // Momento de la compilación: se ve en Diagnóstico para saber qué versión tiene el teléfono.
    define: { __BUILD_ID__: JSON.stringify(new Date().toISOString()) },
    envDir: ENV_DIR,
    envPrefix: ENV_PREFIX,
    plugins: [
      react(),
      // Mapa autoalojado en /map/ (ADR-008).
      mapDataPlugin(fileURLToPath(new URL("../../map-data", import.meta.url))),
      {
        // El <title> sale del entorno, como el manifiesto (nombre provisorio).
        name: "routcontrol-app-name",
        transformIndexHtml: (html: string) => html.replace("__APP_NAME__", appName),
      },
      VitePWA({
        registerType: "prompt",
        injectRegister: false, // lo registra src/pwa.ts
        includeAssets: ["favicon.svg", "apple-touch-icon-180x180.png"],
        manifest: {
          name: appName,
          short_name: appName,
          description: `${appName}: jornadas y entregas para repartidores`,
          lang: "es-AR",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          theme_color: "#070B1F",
          background_color: "#070B1F",
          icons: [
            { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          // MapLibre (~1 MB) solo se usa en "Mis recorridos" y el mapa igual necesita red para las
          // teselas: no se descarga al instalar la app (datos móviles), sino al abrir el mapa.
          globIgnores: [
            "**/maplibre-gl-*.js",
            "**/maplibre-gl-*.css",
            "**/TrackMap-*.js",
            "**/TrackMap-*.css",
            // Plus Jakarta Sans: para español alcanza el subconjunto "latin" (á, é, ñ, ¿, ¡). Los
            // demás alfabetos los baja el navegador solo si alguna vez hacen falta.
            "**/plus-jakarta-sans-cyrillic*",
            "**/plus-jakarta-sans-vietnamese*",
            "**/plus-jakarta-sans-latin-ext*",
            "**/plus-jakarta-sans-*-italic*",
            // El mapa (/map/) no va en la instalación: se guarda la primera vez que se usa.
            "map/**",
            "**/maplibre-gl-worker-*",
          ],
          navigateFallback: "/index.html",
          // La API nunca pasa por el caché del Service Worker: los datos van por IndexedDB.
          navigateFallbackDenylist: [/^\/api\//, /^\/map\//],
          runtimeCaching: [
            {
              // Fuentes e íconos del mapa: cambian solo al actualizar el mapa; sirven sin conexión.
              urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/map\/(fonts|sprites)\//.test(url.pathname),
              handler: "CacheFirst",
              options: { cacheName: "rc-map-assets", expiration: { maxEntries: 60 } },
            },
            {
              // Lector de códigos (ZXing en WebAssembly, ADR-014): se guarda la primera vez que se
              // usa, para poder escanear en el depósito sin señal. Su nombre lleva hash.
              urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith(".wasm"),
              handler: "CacheFirst",
              options: { cacheName: "rc-scanner", expiration: { maxEntries: 4 } },
            },
            {
              // Código del mapa (MapLibre, su worker y TrackMap): no va en la instalación, pero se
              // guarda la primera vez que se abre el mapa o al guardar el mapa sin conexión (ADR-018).
              urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/assets\/(maplibre-gl|TrackMap)-/.test(url.pathname),
              handler: "CacheFirst",
              options: { cacheName: "rc-map-code", expiration: { maxEntries: 12 } },
            },
            // Las teselas (.pmtiles) se piden por rango: van siempre a la red, sin pasar por el
            // caché del Service Worker (nunca puede devolver una versión vieja o rota).
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    server: {
      host: true, // accesible desde el teléfono en la red local
      port: 5173,
      strictPort: true,
      proxy,
      // Túneles HTTPS para probar en el teléfono (§6.1): Cloudflare Tunnel y ngrok.
      allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.app"],
    },
    preview: {
      host: true,
      port: 4173,
      strictPort: true,
      proxy,
      allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.app"],
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      restoreMocks: true,
      // Muchas pruebas recorren la app entera (login, jornada, paquetes): con la compu cargada
      // (servidores prendidos, poca RAM) pasan los 5 s por defecto sin que nada esté mal.
      testTimeout: 15_000,
    },
  };
});
