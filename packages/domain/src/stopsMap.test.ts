import { describe, expect, it } from "vitest";

import type { DeliveryPackage, PackageStatus } from "./packages";
import { decodePolyline, filterStops, formatDistance, mapStops, routeLegs } from "./stopsMap";

let seq = 0;
function pkg(status: PackageStatus, location: { lat: number; lng: number } | null = { lat: -34.6, lng: -58.38 }): DeliveryPackage {
  seq += 1;
  const n = String(seq).padStart(12, "0");
  return {
    id: `0192f3a0-0000-7000-8000-${n}`,
    tracking_code: `P-${seq}`,
    source: "MANUAL",
    status,
    recipient_name: "",
    recipient_phone: "",
    notes: "",
    address: { id: `0192f3a0-0000-7000-9000-${n}`, raw_text: `Calle ${seq}`, street: "", number: "", floor_unit: "", locality: "", province: "", postal_code: "", location },
    assigned_driver: null,
    assigned_at: null,
    version: 1,
    created_at: "2026-11-02T09:00:00Z",
    updated_at: "2026-11-02T09:00:00Z",
  };
}

describe("mapa de entregas", () => {
  it("una casita por domicilio con su número (orden de la ruta, después la lista) y su estado", () => {
    const a = pkg("ASSIGNED");
    const b = pkg("DELIVERED");
    const c = pkg("FAILED");
    const d = pkg("RESCHEDULED");
    const e = pkg("ASSIGNED", null); // sin ubicación: no tiene pin, pero cuenta para el número
    const f = pkg("CANCELLED");
    const stops = mapStops([a, b, c, d, e, f], { order: [d.id, e.id, a.id] });
    expect(stops.map((s) => [s.id, s.n, s.state])).toEqual([
      [d.id, 1, "second"],
      [a.id, 3, "pending"],
      [b.id, 4, "delivered"],
      [c.id, 5, "failed"],
    ]);
    expect(filterStops(stops, "pending").map((s) => s.id)).toEqual([d.id, a.id]);
    expect(filterStops(stops, "all")).toHaveLength(4);
  });

  it("un segundo intento aceptado (vuelve a asignado) se ve como segundo intento", () => {
    const p = { ...pkg("ASSIGNED"), second_attempt: { window_start: null, window_end: null, note: "" } };
    expect(mapStops([p], null)[0]!.state).toBe("second");
    expect(filterStops(mapStops([p], null), "pending")).toHaveLength(1);
  });

  it("la línea de la ruta usa el tramo por calles y, si no hay, una recta desde la parada anterior", () => {
    const a = pkg("ASSIGNED", { lat: -34.6, lng: -58.38 });
    const b = pkg("ASSIGNED", { lat: -34.61, lng: -58.39 });
    const c = pkg("ASSIGNED", { lat: -34.62, lng: -58.4 });
    // "_p~iF~ps|U_ulLnnqC_mqNvxq`@": ejemplo de la documentación del formato.
    const legs = routeLegs({ order: [a.id, b.id, c.id], paths: { [b.id]: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } }, [a, b, c]);
    expect(legs).toHaveLength(2);
    expect(legs[0]!.straight).toBe(false);
    expect(legs[0]!.coords[0]![0]).toBeCloseTo(-120.2);
    expect(legs[1]).toEqual({ coords: [[-58.39, -34.61], [-58.4, -34.62]], straight: true });
    expect(routeLegs(null, [a])).toEqual([]);
  });

  it("decodifica polilíneas y muestra distancias legibles", () => {
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts.map(([lng, lat]) => [Number(lat.toFixed(3)), Number(lng.toFixed(3))])).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
    expect(decodePolyline("")).toEqual([]);
    expect(formatDistance(648)).toBe("a 650 m");
    expect(formatDistance(2400)).toBe("a 2,4 km");
  });
});
