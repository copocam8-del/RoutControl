import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReceptionBadge } from "./Reception";

describe("indicador de recepción", () => {
  it("texto y tono por nivel, con el detalle en el título", () => {
    render(<ReceptionBadge reception={{ level: "green", score: 0.86, computable: 7 }} />);
    const chip = screen.getByText("Suele recibir");
    expect(chip.closest(".rc-badge")!.className).toContain("rc-badge--success");
    expect(chip.closest(".rc-reception")!.getAttribute("title")).toBe("Recibió (86 %) en 7 visitas que cuentan (las más recientes pesan más).");
  });

  it("gris sin historial; sin dato, nada", () => {
    const { container, rerender } = render(<ReceptionBadge reception={{ level: "gray", score: null, computable: 1 }} />);
    expect(screen.getByText("Sin historial").closest(".rc-reception")!.getAttribute("title")).toBe("Menos de 3 visitas que cuenten (1).");
    rerender(<ReceptionBadge reception={undefined} />);
    expect(container.textContent).toBe("");
  });
});
