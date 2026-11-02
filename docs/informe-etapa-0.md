# Informe de la etapa 0: fundaciones y validación de la PWA en teléfonos reales

**Fecha:** 01/11/2026
**Rama:** `etapa-0/admin`. Contiene las ramas `etapa-0/backend`, `etapa-0/driver`, `etapa-0/diseno` y `etapa-0/permiso-ubicacion`.

**Objetivo (§14 de la planificación):** tener la base multitenant funcionando y comprobar en teléfonos reales que la PWA hace lo que necesitamos, sin Mac ni cuentas de las tiendas.

## Resultado

**La etapa 0 cumple el criterio de salida:**
- La PWA se instala y funciona en Android y en iPhone.
- Los puntos llegan sin duplicados y con la hora del teléfono.
- El aislamiento entre empresas está demostrado con pruebas que se conectan como el usuario de la aplicación, sin privilegios.

## Qué se construyó

### Backend (Django 5.2 + DRF + PostGIS, en Docker)
- **Multitenancy con RLS**, siguiendo las reglas de ADR-001:
  - **Dos roles de base.** `rc_owner` corre las migraciones; `rc_app` es el de la aplicación: no es superusuario, no es dueño de las tablas y no tiene `BYPASSRLS`.
  - **Contexto de la empresa:** sale del token, con `set_config('app.current_org')` dentro de cada transacción.
  - **Políticas RLS (`ENABLE` + `FORCE`):** se generan desde los modelos, incluida la tabla de empresas.
  - **FK compuestas:** con `organization_id`.
  - **Búsquedas previas al contexto:** solo con funciones `SECURITY DEFINER` acotadas, que devuelven únicamente `organization_id` y un id.
- **Sesión web (ADR-005):**
  - el access token vive en memoria y el refresh en una cookie httpOnly;
  - el refresh rota con sesiones propias (`RefreshSession`, sin guardar el token);
  - si se reusa un token, se revocan todas las sesiones del usuario;
  - el email no distingue mayúsculas ni espacios.
- **Jornadas:**
  - iniciar y finalizar son idempotentes, con la ubicación del evento;
  - una sola jornada activa por repartidor.
- **Ingesta GPS (ADR-003):**
  - `POST /tracking/batch` es idempotente por `point_id` y guarda las dos horas (`recorded_at` y `received_at`);
  - ventana estricta entre el inicio y el fin, con 72 h de gracia configurables;
  - motivos de rechazo claros, y revocación al desactivar el dispositivo o el repartidor;
  - los huecos se calculan del lado del servidor.
- **Lectura para el panel:**
  - recorrido por jornada, con tramos y huecos;
  - listado de jornadas con la cantidad de ubicaciones y de huecos y la última señal;
  - listado de repartidores con la última ubicación conocida.

### PWA del repartidor (`apps/driver`: React + Vite + Dexie)
- **Datos y envío:**
  - instalable y offline primero: cada punto se guarda en IndexedDB antes de enviarse;
  - cola de envío con espera creciente, e indicador de sincronización siempre visible.
- **Ubicación:**
  - capa `DeviceServices` (implementación web; la nativa llega con Capacitor);
  - el permiso se pide en el mismo toque de "Iniciar jornada", como exige iOS;
  - si el permiso está bloqueado, la app muestra los pasos para iPhone y para Android.
- **Pantallas:** con el diseño aprobado: bienvenida animada, Ingresar, Inicio, Jornada en curso, Mi recorrido con mapa, y Perfil con Diagnóstico y apariencia.
- **Actualización sola** cuando no hay una jornada en curso.

### Panel (`apps/admin`)
- **Diseño:** el aprobado: bienvenida, login en dos columnas, inicio con "Dónde están ahora", Jornadas con el recorrido al costado, y Repartidores.
- **Datos:** solo reales; lo que todavía no existe no aparece.

### Compartido
- **`packages/ui`:** sistema de diseño con tema oscuro y modo claro (ADR-007), contraste verificado por pruebas, y mapas MapLibre.
- **`packages/domain`:** contratos en zod.
- **`packages/api-client`:** el cliente HTTP compartido por las dos apps.
- **Mapa autoalojado (ADR-008):**
  - OpenStreetMap en PMTiles, con fuentes, íconos y el worker de MapLibre, todo desde nuestro origen;
  - sin otros dominios ni claves;
  - errores con detalle en Diagnóstico.

## Pruebas en teléfonos reales

| Teléfono | Resultado | Problemas encontrados y cómo se resolvieron |
|---|---|---|
| **Android (Chrome)** | ✅ Funciona: instalación, login, jornada, ubicación con la app abierta, envío sin conexión y al volver la señal, recorrido | **El mapa no cargaba.** MapLibre v6 busca su worker en un archivo aparte y la compilación no lo publicaba: el pedido devolvía la página de la app (HTML). Ahora el worker se publica con la app y se indica con `setWorkerUrl` (ADR-008) |
| **iPhone 15 (iOS 18, PWA instalada desde Safari)** | ✅ Funciona | **El login fallaba** por el autocompletado y el teclado del iPhone: mayúscula inicial y espacios en el email. Ahora el email no distingue mayúsculas ni espacios, y los campos tienen `autocapitalize`, `autocorrect` y `spellcheck` apagados. **El permiso de ubicación no se pedía:** ahora se pide en el mismo toque, con los pasos si está bloqueado. **El mapa no aparecía** porque el teléfono seguía con la versión vieja guardada (la nueva solo se instalaba si se aceptaba un cartel). Ahora la PWA se actualiza sola sin jornada en curso. Verificado también con WebKit (motor de Safari) emulando un iPhone 15 |
| **Brave (Android)** | ✅ Funciona con el mapa autoalojado | Con las teselas de otro dominio, el mapa dependía de lo que dejara pasar el bloqueador. Ahora todo sale de nuestro origen |

### Pruebas automáticas (al cierre)

| Parte | Pruebas |
|---|---|
| Backend (como `rc_app`, sin privilegios) | 149 |
| `packages/ui` | 248 (incluye el contraste de las dos paletas y el mapa) |
| `packages/domain` | 16 |
| PWA | 114 (y 10 contra el Django real) |
| Panel | 32 (y 5 contra el Django real) |

## Límites conocidos de la PWA (§4)

- **Sin ubicación en segundo plano:**
  - con la pantalla bloqueada o la app cerrada, no se registra el recorrido, y esos tramos quedan como huecos;
  - las jornadas de la PWA quedan marcadas `EVENTS_ONLY` para no compararlas con el recorrido continuo;
  - el recorrido continuo llega con la app de las tiendas (Capacitor, §14.1 fase 2).
- **iOS:**
  - el permiso de ubicación solo se pide dentro de un toque;
  - si el usuario lo bloquea, hay que habilitarlo desde Ajustes, y la app no puede volver a preguntarlo;
  - la PWA instalada casi nunca se cierra del todo, por eso las actualizaciones tienen que instalarse solas.
- **Otros límites:**
  - **Wake Lock:** mantener la pantalla encendida depende del navegador, y Safari lo soporta parcialmente.
  - **Batería:** Safari no la informa, así que la app no la muestra.
  - **Mapa:** cubre solo la zona recortada (AMBA). Para usarlo sin conexión todavía falta guardar la zona en el teléfono, que es de la etapa 1.
  - **Varias pestañas:** si dos pestañas renuevan la sesión a la vez, pueden cerrarla por la detección de reuso (ADR-005).

## Decisiones tomadas

| Decisión | Dónde |
|---|---|
| Django en Docker; dos roles de base y RLS con `FORCE`; las pruebas de aislamiento corren como `rc_app` | ADR-001, ADR-004 |
| Ingesta idempotente por `point_id`, con ventana estricta y gracia configurable | ADR-003 |
| Access token en memoria, refresh en cookie httpOnly, sesiones propias con detección de reuso | ADR-005 |
| IndexedDB (Dexie) como almacenamiento local de la PWA | ADR-006 |
| Diseño: tema oscuro de las maquetas aprobadas y modo claro con selector de apariencia | ADR-007 |
| Mapas de OpenStreetMap autoalojados (PMTiles); "Navegar" con enlaces a Google Maps o Waze; "Armar mi ruta" con OSRM y VROOM en la etapa 1 | ADR-008 |
| Primero la PWA, sin tiendas; la app nativa con Capacitor después | Planificación v0.5 |

## Lo que se quitó al cerrar
- **El diagnóstico de contraseñas** de las cuentas demo, que se usó para el problema del iPhone. Registraba en los logs la forma de la contraseña y la diferencia con `DEMO_PASSWORD` (`LOG_FAILED_LOGIN_SHAPE`). Una prueba verifica que un login fallido ya no registra nada de la contraseña.
- **Las herramientas de prueba en navegador:** Chrome por DevTools y WebKit con Playwright. Se usaron fuera del repositorio y no quedaron en él.

Se mantienen porque son parte del producto (§10.2): la pantalla de **Diagnóstico** (permisos, envíos pendientes, errores del mapa y versión instalada) y las pruebas contra el Django real (`test:real`).

## Pendientes para la etapa 1

El detalle está en [pendientes-etapa-1.md](pendientes-etapa-1.md). Lo principal:

1. **Producto:**
   - paquetes;
   - importación;
   - asignación;
   - visitas con resultado y fotos;
   - Llamar, WhatsApp y Navegar (Google Maps o Waze);
   - **"Armar mi ruta"** con OSRM y VROOM autoalojados.
2. **Mapa:**
   - guardar la zona de los paquetes en el teléfono para usarlo sin conexión;
   - un PMTiles por región de cada empresa, o uno de Argentina;
   - mapa en vivo en el panel con WebSocket.
3. **Seguridad:**
   - RLS en `accounts_user`, con login por una función `SECURITY DEFINER`;
   - revocación inmediata del access token;
   - acceso de soporte entre empresas, auditado;
   - auditoría del acceso a los recorridos.
4. **Tracking:**
   - recuperar los puntos trabados cuando el token de seguimiento queda inválido;
   - cierre automático de jornadas (Celery);
   - simplificar los recorridos largos.
5. **Sesión:** coordinar la renovación entre pestañas (`BroadcastChannel`).
6. **Panel:**
   - TanStack Router;
   - panel instalable como PWA de escritorio;
   - "hoy" en la zona horaria de la empresa.
7. **Producción:**
   - dominio y hosting, con el archivo PMTiles servido con soporte de rangos;
   - revisión legal del aviso de privacidad (Ley 25.326, §11);
   - revisión visual del modo claro en teléfonos.
