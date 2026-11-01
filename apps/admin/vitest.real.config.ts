import { defineConfig } from "vitest/config";

/**
 * Pruebas del panel contra el backend REAL (Django) por el proxy de Vite. No corren con `pnpm test`.
 * Requieren `pnpm backend:dev`, `pnpm backend:seed` y `pnpm --filter @routcontrol/admin dev`.
 */
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.real.ts"], testTimeout: 30_000, fileParallelism: false },
});
