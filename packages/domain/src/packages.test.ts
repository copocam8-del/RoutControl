import { describe, expect, it } from "vitest";

import { deliveryPackage, FINAL_PACKAGE_STATUSES, PACKAGE_STATUS_LABEL, packageStatus } from "./packages";

describe("contrato de paquetes", () => {
  it("valida un paquete como lo devuelve el backend", () => {
    const p = deliveryPackage.parse({
      id: "0192f3a0-0000-7000-8000-000000000001",
      tracking_code: "RC-1",
      source: "MANUAL",
      status: "ASSIGNED",
      recipient_name: "Ana",
      recipient_phone: "",
      notes: "",
      address: {
        id: "0192f3a0-0000-7000-8000-000000000002",
        raw_text: "Calle 1",
        street: "",
        number: "",
        floor_unit: "",
        locality: "",
        province: "",
        postal_code: "",
        location: null,
      },
      assigned_driver: { id: "0192f3a0-0000-7000-8000-000000000003", name: "Repartidor" },
      assigned_at: "2026-11-02T10:00:00Z",
      version: 2,
      created_at: "2026-11-02T09:00:00Z",
      updated_at: "2026-11-02T10:00:00Z",
    });
    expect(p.status).toBe("ASSIGNED");
  });

  it("todos los estados tienen nombre, y los finales son tres", () => {
    for (const s of packageStatus.options) expect(PACKAGE_STATUS_LABEL[s]).toBeTruthy();
    expect(FINAL_PACKAGE_STATUSES).toEqual(["DELIVERED", "RETURNED", "CANCELLED"]);
  });
});
