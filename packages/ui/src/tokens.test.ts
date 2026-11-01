// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { color, contrastPairs, contrastRatio } from "./tokens";

describe("paleta (ADR-007): contraste WCAG", () => {
  it.each(contrastPairs)("$use: $fg sobre $bg ≥ $min:1", ({ fg, bg, min }) => {
    expect(contrastRatio(color[fg], color[bg])).toBeGreaterThanOrEqual(min);
  });

  it("el cálculo de contraste da los valores de referencia de WCAG", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });
});

describe("styles.css refleja tokens.ts", () => {
  const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf-8");
  const kebab = (k: string) =>
    k
      .replace(/([a-z])([A-Z0-9])/g, "$1-$2")
      .replace(/([0-9])([a-zA-Z])/g, "$1-$2")
      .toLowerCase();

  it.each(Object.entries(color))("--rc-%s", (name, value) => {
    const match = new RegExp(`--rc-${kebab(name)}:\\s*(#[0-9A-Fa-f]{6})`).exec(css);
    expect(match?.[1]?.toUpperCase(), `falta o no coincide --rc-${kebab(name)}`).toBe(value.toUpperCase());
  });

  it("no queda el ámbar de la paleta anterior (§10.1 v0.5)", () => {
    expect(css.toUpperCase()).not.toContain("#F59E0B");
  });
});
