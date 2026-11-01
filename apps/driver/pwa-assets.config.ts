import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// Genera los íconos PNG de la PWA (Android, iOS, maskable) desde public/favicon.svg.
// Correr con `pnpm --filter @routcontrol/driver icons` cuando cambie el ícono.
// El relleno de los íconos "maskable" y de iOS es el fondo oscuro de la app (docs/diseno/).
const background = "#070B1F";

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background } },
  },
  images: ["public/favicon.svg"],
});
