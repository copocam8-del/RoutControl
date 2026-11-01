import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// Genera los íconos PNG de la PWA (Android, iOS, maskable) desde public/favicon.svg.
// Correr con `pnpm --filter @routcontrol/driver icons` cuando cambie el ícono.
export default defineConfig({
  preset: minimal2023Preset,
  images: ["public/favicon.svg"],
});
