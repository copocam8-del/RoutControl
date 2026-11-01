import { defineConfig } from "vitest/config";

/**
 * Pruebas contra el backend REAL (Django) a través del proxy de Vite. No corren con `pnpm test`:
 * necesitan levantados el backend (`pnpm backend:dev`), el seed (`pnpm backend:seed`) y Vite
 * (`pnpm driver:dev`). Correr con `pnpm --filter @routcontrol/driver test:real`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.real.ts"],
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
