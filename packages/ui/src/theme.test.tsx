import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTheme, getThemePreference, resolveTheme, setThemePreference, ThemeSelector } from "./index";
import { buildStyle, DEFAULT_MAP_SOURCE } from "./map/style";

function prefersLight(light: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: light && q.includes("light"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  localStorage.clear();
  applyTheme("dark");
});

afterEach(() => vi.unstubAllGlobals());

describe("apariencia", () => {
  it("por defecto, Oscuro", () => {
    expect(getThemePreference("u1")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("se guarda por usuario en el dispositivo; antes de ingresar se usa la última", () => {
    setThemePreference("u1", "light");
    setThemePreference("u2", "auto");
    expect(getThemePreference("u1")).toBe("light");
    expect(getThemePreference("u2")).toBe("auto");
    expect(getThemePreference("u3")).toBe("auto"); // sin elección propia: la última del dispositivo
    expect(getThemePreference(null)).toBe("auto");
  });

  it("Automático sigue prefers-color-scheme", () => {
    prefersLight(true);
    expect(resolveTheme("auto")).toBe("light");
    prefersLight(false);
    expect(resolveTheme("auto")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("aplicar pone data-theme y el color de la barra del sistema", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(meta.content).toBe("#F4F6FD");
    applyTheme("dark");
    expect(meta.content).toBe("#070B1F");
    meta.remove();
  });

  it("el selector: Oscuro / Claro / Automático, accesible y guarda la elección del usuario", async () => {
    render(<ThemeSelector userId="u9" />);
    const group = screen.getByRole("radiogroup", { name: "Apariencia" });
    expect(group).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Oscuro" }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole("radio", { name: "Claro" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(getThemePreference("u9")).toBe("light");
    expect((screen.getByRole("radio", { name: "Claro" }) as HTMLInputElement).checked).toBe(true);
  });

  it("el mapa usa el estilo claro y sus íconos en modo claro", () => {
    const dark = buildStyle(DEFAULT_MAP_SOURCE, "dark");
    const light = buildStyle(DEFAULT_MAP_SOURCE, "light");
    expect(dark.sprite).toMatch(/sprites\/dark$/);
    expect(light.sprite).toMatch(/sprites\/light$/);
    const bg = (s: typeof light) => (s.layers.find((l) => l.type === "background") as { paint: { "background-color": string } }).paint["background-color"];
    expect(bg(light)).toBe("#EEF1F8");
    expect(bg(dark)).toBe("#0C1230");
  });
});
