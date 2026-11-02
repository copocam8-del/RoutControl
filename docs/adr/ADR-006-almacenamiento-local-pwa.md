# ADR-006 — Qué guarda la PWA en el teléfono

- **Estado:** propuesto (etapa 0)
- **Fecha:** 31/10/2026
- **Contexto:** §5.2, §5.3 y §11 de la planificación; ADR-003 (token de seguimiento) y ADR-005 (sesión web).

## Decisión

| Dato | Dónde | Por qué |
|---|---|---|
| Access token | **Solo en memoria** (`ApiClient`) | ADR-005. Una prueba verifica que no aparece en `localStorage` ni en `sessionStorage` |
| Refresh token | Cookie httpOnly (el JavaScript no la ve) | ADR-005 |
| Puntos GPS pendientes | IndexedDB (Dexie), tabla `points` | Offline primero: se guardan **antes** de intentar enviarlos y se borran solo cuando el servidor los resuelve (aceptado, duplicado o rechazado) |
| Jornada actual **y su TrackingToken** | IndexedDB, tabla `workdays` | Ver abajo |
| Id del dispositivo (UUIDv7) | IndexedDB, tabla `meta` | Se genera una vez por instalación |
| Registro de diagnóstico | IndexedDB, tabla `log`, últimas 200 entradas | Pantalla de diagnóstico (§10.2) |

### Por qué el TrackingToken sí se guarda

Los puntos pendientes tienen que poder enviarse aunque la app se recargue, el navegador la cierre o la sesión del usuario venza en medio de la jornada (offline primero, "puntos perdidos: 0"). Si el token viviera solo en memoria, una recarga dejaría esos puntos sin forma de subirse.

El riesgo es acotado:

- el token sirve **solo** para `POST /tracking/batch`, de **una** jornada y **un** dispositivo;
- solo acepta puntos dentro de la ventana de la jornada;
- vence (14 h, más la gracia después del fin) y se revoca al desactivar el dispositivo o el repartidor (ADR-003);
- se borra del teléfono junto con la jornada, cuando ya no quedan puntos pendientes.

## Consecuencias

- "Salir" (cerrar sesión) está deshabilitado mientras haya una jornada activa o puntos sin enviar. Si no, se perderían.
- Los datos del teléfono son solo los de la jornada actual (§11). Cuando una jornada terminó en el servidor y no le quedan puntos, se borra.
- Se pide `navigator.storage.persist()` al iniciar la primera jornada. En iPhone, IndexedDB no se borra a los 7 días **si la PWA está instalada**, y la app lo indica en la pantalla de inicio.
- En la fase 2 (Capacitor), la misma información pasa a SQLite y el token al almacenamiento seguro del sistema, detrás de la misma interfaz.
