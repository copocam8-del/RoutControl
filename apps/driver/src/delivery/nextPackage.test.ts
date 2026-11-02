/** Próxima parada: la misma regla para Inicio y para el mapa. */
import { describe, expect, it } from "vitest";

import { testPackage } from "../test/packages";
import { nextPackage } from "./deliveries";

describe("próxima parada", () => {
  const a = testPackage();
  const b = testPackage();
  const c = testPackage({ status: "IN_ROUTE" });
  const done = testPackage({ status: "DELIVERED" });
  const route = { order: [b.id, a.id, c.id], source: "OPTIMIZED" as const, total_eta_s: null, total_distance_m: null };

  it("la visita en curso manda, aunque haya otras antes en la ruta", () => {
    expect(nextPackage([a, b, c], route, a.id)?.id).toBe(a.id);
  });

  it("sin visita: el primero que ya está en camino; si no hay, el primero de la ruta", () => {
    expect(nextPackage([a, b, c], route, null)?.id).toBe(c.id);
    expect(nextPackage([a, b], route, null)?.id).toBe(b.id);
    expect(nextPackage([a, b], null, null)?.id).toBe(a.id);
  });

  it("sin pendientes no hay próxima", () => {
    expect(nextPackage([done], route, null)).toBeNull();
  });
});
