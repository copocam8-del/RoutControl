import { describe, expect, it } from "vitest";

import { FAILURE_REASONS, googleMapsUrl, OUTCOME_LABEL, telUrl, wazeUrl, whatsappNumber, whatsappUrl } from "./delivery";

describe("enlaces de la ficha (sin API de Google)", () => {
  const withCoords = { raw_text: "Av. Corrientes 1234, CABA", location: { lat: -34.6037, lng: -58.3816 } };
  const onlyText = { raw_text: "Av. Corrientes 1234, CABA", location: null };

  it("Google Maps: por coordenadas si las hay; si no, por la dirección", () => {
    expect(googleMapsUrl(withCoords)).toBe("https://www.google.com/maps/dir/?api=1&destination=-34.6037%2C-58.3816&travelmode=driving");
    expect(googleMapsUrl(onlyText)).toContain("destination=Av.%20Corrientes%201234%2C%20CABA");
  });

  it("Waze: navega por coordenadas o busca la dirección", () => {
    expect(wazeUrl(withCoords)).toBe("https://waze.com/ul?ll=-34.6037,-58.3816&navigate=yes");
    expect(wazeUrl(onlyText)).toBe("https://waze.com/ul?q=Av.%20Corrientes%201234%2C%20CABA&navigate=yes");
  });

  it.each([
    ["+54 9 11 5555-0000", "5491155550000"],
    ["+54 11 5555-0000", "5491155550000"],
    ["011 15 5555-0000", "5491155550000"],
    ["11 5555-0000", "5491155550000"],
    ["0351 15 555-1234", "5493515551234"],
    ["0054 9 11 5555 0000", "5491155550000"],
    ["123", null],
    ["", null],
  ])("WhatsApp: %s → %s", (phone, expected) => {
    expect(whatsappNumber(phone)).toBe(expected);
  });

  it("los enlaces de WhatsApp y teléfono, o null si no hay número", () => {
    expect(whatsappUrl("11 5555-0000")).toBe("https://wa.me/5491155550000");
    expect(whatsappUrl("")).toBeNull();
    expect(telUrl("+54 11 5555-0000")).toBe("tel:+541155550000");
    expect(telUrl("12")).toBeNull();
  });

  it("los seis motivos de 'No entregado' tienen nombre", () => {
    expect(FAILURE_REASONS).toHaveLength(6);
    expect(OUTCOME_LABEL.DELIVERED).toBe("Entregado");
    expect(OUTCOME_LABEL.OTHER).toBe("Otro inconveniente");
  });
});
