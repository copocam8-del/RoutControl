// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { color, contrastPairs, contrastRatio, lightColor, lightContrastPairs, lightValue, themeTints } from "./tokens";

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

  it("los campos (de la app y del panel) tienen el contorno de formulario #5A67B0, no el de las tarjetas", () => {
    const rule = /\.rc-field__input \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("border: 1.5px solid var(--rc-field-border)");
    expect(color.fieldBorder).toBe("#5A67B0");
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
  const values = new Set(
    [...Object.values(color), ...Object.values(lightColor), ...Object.values(themeTints.light)].map((v) => v.toUpperCase()),
  );

  it("hay colores en la tabla", () => expect(hexes.length).toBeGreaterThan(15));
  it.each(hexes)("%s está en tokens.ts", (hex) => {
    expect(values.has(hex)).toBe(true);
  });
});

describe("modo claro (ADR-007 v3): contraste WCAG AA como mínimo", () => {
  it.each(lightContrastPairs)("$use: $fg sobre $bg ≥ $min:1", ({ fg, bg, min }) => {
    expect(contrastRatio(lightValue(fg), lightValue(bg))).toBeGreaterThanOrEqual(min);
  });

  it("los valores aprobados por el cliente", () => {
    expect(lightColor).toMatchObject({
      background: "#F4F6FD",
      surface: "#FFFFFF",
      surface2: "#EDF0FB",
      sidebar: "#FFFFFF",
      border: "#DDE2F4",
      fieldBorder: "#7A85BD",
      text: "#0B1026",
      text2: "#2E365C",
      muted: "#525B85",
      primary: "#6D4AFF",
      violet300: "#5B3FD9",
      blue: "#2563EB",
      successText: "#047857",
      warningText: "#B45309",
      gap: "#EA580C",
      route: "#7C3AED",
    });
    expect(themeTints.light).toMatchObject({ successBg: "#D1FAE5", warningBg: "#FEF3C7", sidebarBorder: "#DDE2F4" });
  });
});

describe("styles.css: el modo claro refleja tokens.ts", () => {
  const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf-8");
  const kebab = (k: string) =>
    k
      .replace(/([a-z])([A-Z0-9])/g, "$1-$2")
      .replace(/([0-9])([a-zA-Z])/g, "$1-$2")
      .toLowerCase();
  const blockOf = (selector: string) => {
    const start = css.indexOf(selector);
    return css.slice(start, css.indexOf("}", start));
  };
  const explicit = blockOf(':root[data-theme="light"] {');
  const auto = blockOf(':root[data-theme="auto"] {');

  it.each([...Object.entries(lightColor), ...Object.entries(themeTints.light)])("--rc-%s en Claro y en Automático", (name, value) => {
    const re = new RegExp(`--rc-${kebab(name)}:\\s*(#[0-9A-Fa-f]{6})`);
    expect(re.exec(explicit)?.[1]?.toUpperCase()).toBe(value.toUpperCase());
    expect(re.exec(auto)?.[1]?.toUpperCase()).toBe(value.toUpperCase());
  });

  it("Automático sigue al sistema y el oscuro es el tema por defecto", () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: light\) \{\s*:root\[data-theme="auto"\]/);
    expect(css).toMatch(/:root \{[^}]*--rc-background: #070B1F/);
  });

  it("no quedan transparencias con colores fijos del tema oscuro fuera de las variables", () => {
    const rules = css.slice(css.indexOf("*,\n*::before"));
    expect(rules.match(/rgba\((52, 211, 153|251, 191, 36|251, 146, 60|248, 113, 113|77, 141, 255|124, 92, 255|7, 11, 31)/g)).toBeNull();
  });
});
