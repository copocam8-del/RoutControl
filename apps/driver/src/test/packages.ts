/** Paquetes de prueba con la forma del backend (los datos son de ejemplo, para las pruebas). */
import type { DeliveryPackage } from "@routcontrol/domain";

let seq = 0;

export function testPackage(overrides: Partial<DeliveryPackage> = {}): DeliveryPackage {
  seq += 1;
  const n = String(seq).padStart(12, "0");
  return {
    id: `0192f3a0-0000-7000-8000-${n}`,
    tracking_code: `PRUEBA-${seq}`,
    source: "MANUAL",
    status: "ASSIGNED",
    recipient_name: `Destinatario ${seq} (prueba)`,
    recipient_phone: "11 5555-0000",
    notes: "",
    address: {
      id: `0192f3a0-0000-7000-9000-${n}`,
      raw_text: `Calle de prueba ${seq}00`,
      street: "",
      number: "",
      floor_unit: "",
      locality: "",
      province: "",
      postal_code: "",
      location: { lat: -34.6, lng: -58.38 },
    },
    assigned_driver: { id: "0192f3a0-0000-7000-8000-0000000000bb", name: "Repartidor de prueba" },
    assigned_at: "2026-11-02T10:00:00Z",
    version: 2,
    created_at: "2026-11-02T09:00:00Z",
    updated_at: "2026-11-02T10:00:00Z",
    ...overrides,
  };
}
