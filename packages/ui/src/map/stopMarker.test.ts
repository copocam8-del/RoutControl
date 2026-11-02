// @vitest-environment jsdom
import type { MapStop } from "@routcontrol/domain";
import { describe, expect, it, vi } from "vitest";

import { stopElement, updateStopElement } from "./stopMarker";

const stop = (o: Partial<MapStop> = {}): MapStop => ({ id: "a", n: 3, lat: -34.6, lng: -58.38, state: "pending", label: "Parada 3: Uno 100", ...o });

describe("casitas del mapa de entregas", () => {
  it("número, estado y etiqueta accesible; al tocarla avisa cuál es", () => {
    const onSelect = vi.fn();
    const el = stopElement(stop(), false, onSelect);
    expect(el.querySelector(".rc-stop__n")!.textContent).toBe("3");
    expect(el.classList.contains("rc-stop--pending")).toBe(true);
    expect(el.getAttribute("aria-label")).toBe("Parada 3: Uno 100 · Pendiente");
    el.click();
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("al actualizarla conserva las clases que le pone MapLibre (si no, las casitas se corren)", () => {
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
