// @vitest-environment jsdom
import type { MapStop } from "@routcontrol/domain";
import { describe, expect, it, vi } from "vitest";

import { stopElement, updateStopElement } from "./stopMarker";

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
