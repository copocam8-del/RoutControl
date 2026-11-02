# ADR-014: Carga de paquetes con escaneo continuo

- **Estado:** aceptado
- **Fecha:** 02/11/2026

## Decisión
- **Backend:** `POST /packages/load {tracking_codes}` (repartidor). Cada código asignado a ese repartidor pasa a **En camino**, con un evento `source: scan`. Responde por código:
  - `loaded`;
  - `already_loaded`, en un reintento o un escaneo repetido;
  - `not_assigned`, que es **la misma respuesta** si el código no existe, si es de un compañero o si es de otra empresa: no revela nada;
  - `not_loadable`, si el paquete ya está entregado, cancelado o devuelto.

  Es idempotente.
- **Lector:**
  - el `BarcodeDetector` del navegador, si soporta los formatos (Chrome en Android);
  - si no (Safari en iPhone, Firefox), **ZXing en WebAssembly** (`barcode-detector` + `zxing-wasm`), con el `.wasm` servido **desde nuestro origen**: `locateFile` apunta al asset de la compilación, no al CDN.
  - El Service Worker guarda el `.wasm` la primera vez (`CacheFirst`), así se puede escanear en el depósito sin señal.
- **Formatos:** Code 128, Code 39, Code 93, Codabar, EAN-13 y EAN-8, ITF, UPC-A y UPC-E, QR, Data Matrix y PDF417. Todavía no hay etiquetas reales para probar (§15.3); se ajusta cuando las haya.
- **Escaneo continuo:**
  - se analiza un cuadro cada 250 ms y se toman **todos los códigos del cuadro** (varias etiquetas a la vista);
  - un código ya leído en la tanda no se repite;
  - cada lectura se compara al instante con los paquetes asignados guardados en el teléfono: "Cargado", "Ya estaba cargado", "No está asignado a vos" o "Ya está resuelto". Vibra distinto si está bien o mal.
- **Ingreso manual** del código, para una etiqueta rota o sin cámara. Si la cámara está bloqueada, se explica y se puede seguir a mano.
- **Offline primero:** la carga va a la misma cola que las visitas, y el paquete pasa a "En camino" en el teléfono enseguida.

## Pendiente
- Probarlo con etiquetas y luz reales en Android y en iPhone (§15.3, pendiente 4).
- La linterna de la cámara (`torch`), donde el navegador la ofrezca.
