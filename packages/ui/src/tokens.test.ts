// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { color, contrastPairs, contrastRatio } from "./tokens";

describe("paleta oscura (ADR-007 v2): contraste WCAG", () => {
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

  it("usa Plus Jakarta Sans empaquetada (no una fuente de Google en línea)", () => {
    expect(css).toContain('@import "@fontsource-variable/plus-jakarta-sans"');
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toContain("Inter");
  });
});

describe("los tokens son los de las maquetas aprobadas (docs/diseno/README.md)", () => {
  const readme = readFileSync(fileURLToPath(new URL("../../../docs/diseno/README.md", import.meta.url)), "utf-8");
  const tokensTable = readme.slice(readme.indexOf("## Tokens"));
  const hexes = [...new Set([...tokensTable.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase()))];
  const values = new Set(Object.values(color).map((v) => v.toUpperCase()));

  it("hay colores en la tabla", () => expect(hexes.length).toBeGreaterThan(15));
  it.each(hexes)("%s está en tokens.ts", (hex) => {
    expect(values.has(hex)).toBe(true);
  });
});
