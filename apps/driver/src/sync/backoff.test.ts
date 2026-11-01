import { describe, expect, it } from "vitest";

import { BACKOFF_STEPS_MS, backoffDelayMs } from "./backoff";

describe("backoffDelayMs", () => {
  it("sigue la escalera 5 s, 15 s, 1 min, 5 min, 15 min, 30 min (sin variación)", () => {
    const noJitter = () => 0.5;
    expect([0, 1, 2, 3, 4, 5].map((a) => backoffDelayMs(a, noJitter))).toEqual([...BACKOFF_STEPS_MS]);
  });

  it("no pasa de 30 min aunque sigan los fallos", () => {
    expect(backoffDelayMs(50, () => 0.5)).toBe(1_800_000);
  });

  it("varía ±20 % para que los teléfonos no reintenten todos juntos", () => {
    expect(backoffDelayMs(0, () => 0)).toBe(4_000);
    expect(backoffDelayMs(0, () => 1)).toBe(6_000);
  });
});
