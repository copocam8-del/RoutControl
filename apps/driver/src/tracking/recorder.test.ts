import { describe, expect, it } from "vitest";

import { config } from "../config";
import type { PositionFix } from "../device/DeviceServices";
import { freshDb } from "../test/helpers";
import { buildPoint, recordPoint, shouldRecord } from "./recorder";

const rules = config.tracking;
const fix = (timestamp: number, lat = -34.6037, lng = -58.3816, speed: number | null = 3): PositionFix => ({
  lat,
  lng,
  accuracy: 10,
  speed,
  heading: null,
  altitude: null,
  timestamp,
});

describe("shouldRecord", () => {
  const t0 = Date.UTC(2026, 9, 31, 12, 0, 0);

  it("guarda siempre la primera fijación", () => {
    expect(shouldRecord(null, fix(t0), rules)).toBe(true);
  });

  it("guarda si pasó el intervalo mínimo aunque esté quieto", () => {
    expect(shouldRecord(fix(t0), fix(t0 + rules.minIntervalMs), rules)).toBe(true);
    expect(shouldRecord(fix(t0), fix(t0 + 5_000), rules)).toBe(false);
  });

  it("guarda antes del intervalo si se movió lo suficiente", () => {
    // ~0,0003° de latitud ≈ 33 m
    expect(shouldRecord(fix(t0), fix(t0 + 5_000, -34.6034), rules)).toBe(true);
  });

  it("descarta fijaciones repetidas o fuera de orden", () => {
    expect(shouldRecord(fix(t0), fix(t0), rules)).toBe(false);
    expect(shouldRecord(fix(t0), fix(t0 - 1_000, -34.7), rules)).toBe(false);
  });
});

describe("buildPoint", () => {
  it("usa la hora de la fijación (reloj del teléfono) y un UUIDv7", () => {
    const t = Date.UTC(2026, 9, 31, 12, 0, 0);
    const p = buildPoint(fix(t, -34.6, -58.4, 2), { source: "FOREGROUND", battery: 0.5, rules });
    expect(p.recorded_at).toBe("2026-10-31T12:00:00.000Z");
    expect(p.point_id[14]).toBe("7");
    expect(p.is_moving).toBe(true);
    expect(p.battery).toBe(0.5);
  });

  it("deja is_moving en null si el navegador no informa velocidad", () => {
    expect(buildPoint(fix(Date.now(), -34.6, -58.4, null), { source: "EVENT", event: "workday_start", battery: null, rules }).is_moving).toBeNull();
  });
});

describe("recordPoint", () => {
  const workday = { id: "w1", started_at: "2026-10-31T12:00:00.000Z", ended_at: "2026-10-31T20:00:00.000Z" };
  const at = (iso: string) => buildPoint(fix(Date.parse(iso)), { source: "FOREGROUND", battery: null, rules });

  it("guarda los puntos dentro de la jornada, extremos incluidos", async () => {
    const db = freshDb();
    for (const iso of [workday.started_at, "2026-10-31T15:00:00.000Z", workday.ended_at]) {
      expect((await recordPoint(db, workday, at(iso))).saved).toBe(true);
    }
    expect(await db.points.count()).toBe(3);
  });

  it("no guarda puntos fuera de la jornada (el servidor los rechazaría siempre)", async () => {
    const db = freshDb();
    expect(await recordPoint(db, workday, at("2026-10-31T11:59:59.999Z"))).toEqual({ saved: false, reason: "before_workday_start" });
    expect(await recordPoint(db, workday, at("2026-10-31T20:00:00.001Z"))).toEqual({ saved: false, reason: "after_workday_end" });
    expect(await db.points.count()).toBe(0);
  });
});
