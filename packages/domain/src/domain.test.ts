import { describe, expect, it } from "vitest";

import {
  distanceMeters,
  gapLines,
  trackBounds,
  workdayTrack,
  locationPoint,
  settledPointIds,
  trackingBatchResponse,
  uuidv7,
  uuidv7Timestamp,
} from "./index";

describe("uuidv7", () => {
  it("genera UUID versión 7 válidos con la hora codificada", () => {
    const now = Date.UTC(2026, 9, 31, 12, 0, 0);
    const id = uuidv7(now);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv7Timestamp(id)).toBe(now);
  });

  it("se ordenan por momento de creación", () => {
    const ids = [3, 1, 2].map((s) => uuidv7(Date.UTC(2026, 0, 1, 0, 0, s)));
    expect([...ids].sort()).toEqual([ids[1], ids[2], ids[0]]);
  });

  it("no se repiten", () => {
    const now = Date.now();
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(now)));
    expect(ids.size).toBe(1000);
  });
});

describe("distanceMeters", () => {
  it("calcula distancias conocidas", () => {
    const obelisco = { lat: -34.6037, lng: -58.3816 };
    const congreso = { lat: -34.6098, lng: -58.3926 };
    expect(distanceMeters(obelisco, congreso)).toBeGreaterThan(1150);
    expect(distanceMeters(obelisco, congreso)).toBeLessThan(1250);
    expect(distanceMeters(obelisco, obelisco)).toBe(0);
  });
});

describe("locationPoint", () => {
  const base = {
    point_id: uuidv7(),
    recorded_at: "2026-10-31T12:00:00.000Z",
    lat: -34.6,
    lng: -58.4,
    accuracy: 10,
  };

  it("acepta un punto válido y pone FOREGROUND por defecto", () => {
    expect(locationPoint.parse(base).source).toBe("FOREGROUND");
  });

  it.each([
    ["sin zona horaria", { recorded_at: "2026-10-31T12:00:00" }],
    ["latitud fuera de rango", { lat: 91 }],
    ["batería en porcentaje", { battery: 80 }],
    ["point_id no UUID", { point_id: "x" }],
  ])("rechaza %s, igual que el servidor", (_name, change) => {
    expect(locationPoint.safeParse({ ...base, ...change }).success).toBe(false);
  });

  it("acepta offsets explícitos", () => {
    expect(locationPoint.safeParse({ ...base, recorded_at: "2026-10-31T09:00:00-03:00" }).success).toBe(true);
  });
});

describe("settledPointIds", () => {
  it("incluye aceptados, duplicados y rechazados, y nada más", () => {
    const response = trackingBatchResponse.parse({
      accepted: ["a"],
      duplicates: ["b"],
      rejected: [{ id: "c", reason: "after_workday_end", detail: "..." }],
      server_time: "2026-10-31T12:00:00Z",
    });
    expect([...settledPointIds(response)].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("recorrido", () => {
  const base = {
    workday: {
      id: "0192f3a0-0000-7000-8000-000000000001",
      status: "FINISHED",
      tracking_mode: "EVENTS_ONLY",
      date: "2026-11-01",
      started_at: "2026-11-01T12:00:00.123000Z",
      ended_at: "2026-11-01T13:00:00Z",
      device_id: "0192f3a0-0000-7000-8000-000000000002",
      driver: { id: "0192f3a0-0000-7000-8000-000000000003", name: "Repartidor" },
    },
    segments: { type: "FeatureCollection", features: [] },
    points: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [-58.4, -34.6] }, properties: { recorded_at: "2026-11-01T12:01:00Z", accuracy_m: 5, source: "EVENT", event: "workday_start" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [-58.3, -34.7] }, properties: { recorded_at: "2026-11-01T12:30:00Z", accuracy_m: 5, source: "FOREGROUND", event: "" } },
      ],
    },
    gaps: [
      { from_at: "2026-11-01T12:00:00Z", to_at: "2026-11-01T12:01:00Z", seconds: 60, reason: "desconocido", from: null, to: [-58.4, -34.6] },
      { from_at: "2026-11-01T12:05:00Z", to_at: "2026-11-01T12:30:00Z", seconds: 1500, reason: "desconocido", from: [-58.4, -34.6], to: [-58.3, -34.7] },
    ],
    stats: { point_count: 2, segment_count: 2, distance_m: 0, gap_count: 2, gap_seconds: 1560 },
  };

  it("acepta la respuesta del backend (con microsegundos)", () => {
    expect(workdayTrack.safeParse(base).success).toBe(true);
  });

  it("dibuja como línea punteada solo los huecos con los dos extremos", () => {
    const lines = gapLines(workdayTrack.parse(base));
    expect(lines.features).toHaveLength(1);
    expect(lines.features[0]!.geometry.coordinates).toEqual([[-58.4, -34.6], [-58.3, -34.7]]);
  });

  it("calcula la caja del recorrido", () => {
    expect(trackBounds(workdayTrack.parse(base))).toEqual([[-58.4, -34.7], [-58.3, -34.6]]);
    expect(trackBounds(workdayTrack.parse({ ...base, points: { type: "FeatureCollection", features: [] } }))).toBeNull();
  });
});
