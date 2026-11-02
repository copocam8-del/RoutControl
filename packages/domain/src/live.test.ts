import { describe, expect, it } from "vitest";

import { liveMessageSchema, type LivePosition, mergeLivePosition } from "./live";

const pos = (o: Partial<LivePosition> = {}): LivePosition => ({
  type: "position",
  driver_id: "d1",
  workday_id: "w1",
  lat: -34.6,
  lng: -58.4,
  recorded_at: "2026-11-02T10:00:00Z",
  ...o,
});

describe("mapa en vivo", () => {
  it("valida los mensajes del servidor", () => {
    expect(liveMessageSchema.parse({ type: "ready" })).toEqual({ type: "ready" });
    expect(liveMessageSchema.safeParse({ ...pos(), lat: 200 }).success).toBe(false);
    expect(liveMessageSchema.safeParse({ type: "otro" }).success).toBe(false);
  });

  it("por repartidor gana la ubicación más reciente; un punto viejo que llega tarde no la pisa", () => {
    let known = mergeLivePosition({}, pos());
    known = mergeLivePosition(known, pos({ recorded_at: "2026-11-02T10:05:00Z", lat: -34.61 }));
    const same = mergeLivePosition(known, pos({ recorded_at: "2026-11-02T10:01:00Z", lat: -34.0 }));
    expect(same).toBe(known);
    expect(known.d1!.lat).toBe(-34.61);
    // Otra jornada del mismo repartidor: reemplaza.
    expect(mergeLivePosition(known, pos({ workday_id: "w2", recorded_at: "2026-11-02T09:00:00Z" })).d1!.workday_id).toBe("w2");
    expect(Object.keys(mergeLivePosition(known, pos({ driver_id: "d2" })))).toEqual(["d1", "d2"]);
  });
});
