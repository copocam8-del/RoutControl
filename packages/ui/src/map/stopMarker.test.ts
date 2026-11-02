// @vitest-environment jsdom
import type { MapStop } from "@routcontrol/domain";
import { describe, expect, it, vi } from "vitest";

import { spreadOffsets, stopElement, updateStopElement } from "./stopMarker";

const stop = (o: Partial<MapStop> = {}): MapStop => ({ id: "a", n: 3, lat: -34.6, lng: -58.38, state: "pending", label: "Parada 3: Uno 100", ...o });

describe("paradas del mapa de entregas (estilo Ruta.dc.html)", () => {
  it("número, estado y etiqueta accesible; al tocarla avisa cuál es", () => {
    const onSelect = vi.fn();
    const el = stopElement(stop(), false, onSelect);
    expect(el.querySelector(".rc-stop__dot > .rc-stop__n")!.textContent).toBe("3");
    // Caen en el orden de la ruta: la 3 después de la 1 y la 2.
    expect((el.querySelector(".rc-stop__dot") as HTMLElement).style.animationDelay).toBe("0.24s");
    expect(el.classList.contains("rc-stop--pending")).toBe(true);
    expect(el.getAttribute("aria-label")).toBe("Parada 3: Uno 100 · Pendiente");
    el.click();
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("la próxima: clase propia, etiqueta 'Próxima' y anillos; deja de serlo al actualizarla", () => {
    const el = stopElement(stop(), false, () => {}, true);
    expect(el.classList.contains("rc-stop--next")).toBe(true);
    expect(el.getAttribute("aria-label")).toBe("Parada 3: Uno 100 · Pendiente · Próxima");
    expect(el.querySelector(".rc-stop__tag")!.textContent).toBe("Próxima");
    expect(el.querySelectorAll(".rc-stop__pulse")).toHaveLength(2);
    updateStopElement(el, stop(), false, false);
    expect(el.classList.contains("rc-stop--next")).toBe(false);
    expect(el.getAttribute("aria-label")).toBe("Parada 3: Uno 100 · Pendiente");
  });

  it("al actualizarla conserva las clases que le pone MapLibre (si no, las paradas se corren)", () => {
    const el = stopElement(stop(), false, () => {});
    el.classList.add("maplibregl-marker", "maplibregl-marker-anchor-bottom");
    updateStopElement(el, stop({ state: "delivered", n: 1 }), true);
    expect([...el.classList].sort()).toEqual(["maplibregl-marker", "maplibregl-marker-anchor-bottom", "rc-stop", "rc-stop--delivered", "rc-stop--selected"]);
    expect(el.getAttribute("aria-pressed")).toBe("true");
    updateStopElement(el, stop({ state: "failed" }), false);
    expect(el.classList.contains("rc-stop--delivered")).toBe(false);
    expect(el.classList.contains("rc-stop--selected")).toBe(false);
    expect(el.classList.contains("maplibregl-marker")).toBe(true);
  });
});

describe("paradas superpuestas", () => {
  it("las que se tocan en pantalla se abren en círculo; las sueltas no se mueven", () => {
    const offsets = spreadOffsets([
      { id: "a", x: 100, y: 100 },
      { id: "b", x: 105, y: 102 }, // el mismo edificio
      { id: "c", x: 300, y: 300 },
    ]);
    expect(offsets.get("c")).toEqual([0, 0]);
    const [ax, ay] = offsets.get("a")!;
    const [bx, by] = offsets.get("b")!;
    // Abiertas: ahora quedan separadas por al menos ~40 px.
    expect(Math.hypot(100 + ax - (105 + bx), 100 + ay - (102 + by))).toBeGreaterThanOrEqual(40);
  });

  it("muchas en el mismo lugar: ninguna queda tapada por otra", () => {
    const pts = Array.from({ length: 8 }, (_, i) => ({ id: String(i), x: 50, y: 50 }));
    const offsets = spreadOffsets(pts);
    const placed = pts.map((p) => [p.x + offsets.get(p.id)![0], p.y + offsets.get(p.id)![1]] as const);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) expect(Math.hypot(placed[i]![0] - placed[j]![0], placed[i]![1] - placed[j]![1])).toBeGreaterThan(30);
  });
});
