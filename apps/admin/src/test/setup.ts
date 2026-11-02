import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sin WebSocket real en las pruebas: el mapa en vivo se prueba con uno falso (live.test.tsx).
Object.defineProperty(globalThis, "WebSocket", { value: undefined, writable: true, configurable: true });

afterEach(() => {
  cleanup();
  window.location.hash = "";
});
