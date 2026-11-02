# RouteControl — Paso 1: Análisis y planificación

**Versión:** 0.5.3 (borrador para revisión)
**Fecha:** 31/10/2026
**Estado:** pendiente de aprobación final. Es la **única fuente de verdad** del proyecto: cualquier otro documento de planificación queda reemplazado por este.

### Historial de cambios
| Versión | Cambio |
|---|---|
| 0.1 | Primera propuesta (app móvil con React Native/Expo). |
| 0.2 | Decisiones del cliente: SaaS multitenant desde el inicio; app del repartidor como PWA. Análisis de limitaciones reales de las PWA. |
| 0.5.3 | **Mapas (ADR-008):** OpenStreetMap autoalojado en PMTiles desde nuestro origen (§5.5); "Navegar" abre Google Maps o Waze con enlaces externos; la optimización de ruta con OSRM y VROOM autoalojados pasa de la etapa 2 a la etapa 1. |
| 0.5.2 | §10.1: **tema oscuro de las maquetas aprobadas** (`docs/diseno/`), con violeta `#7C5CFF` para las acciones principales y Plus Jakarta Sans. Reemplaza a la 0.5.1. Ver ADR-007 v2. |
| 0.5.1 | §10.1: paleta azul (principal) y violeta (acento), en lugar del ámbar. Ver ADR-007. |
| 0.5 | **Primero la PWA, sin tiendas.** Se desarrolla y se lanza RouteControl como PWA para no depender de Google Play ni App Store al principio. La app nativa con Capacitor (y la subida a las tiendas) pasa a una etapa posterior. Mientras tanto el GPS funciona dentro de los límites de la PWA (§4). La etapa 0 pasa a ser la validación de la PWA en teléfonos reales: no requiere Mac ni cuentas de las tiendas. |
| 0.4 | **La PWA es provisoria.** El destino final de la app del repartidor son Google Play y App Store. La PWA solo se usa mientras se esperan las aprobaciones de las tiendas, y después deja de ser el canal de los repartidores. Se agregó el plan de lanzamiento (§14.1). |
| 0.3 | **El recorrido GPS continuo es obligatorio.** La app del repartidor pasa a ser **PWA + Capacitor**: un único código React que se publica como PWA y como app nativa de Android e iOS con ubicación en segundo plano. Backend Django sin cambios. La etapa 0 pasa a ser la **prueba de concepto de GPS continuo** en dispositivos reales. Se descartan Expo/React Native y NestJS/Prisma. |

---

## 0. Decisiones definitivas

| # | Decisión | Estado |
|---|---|---|
| D1 | **SaaS multitenant** desde el inicio. Cada empresa tiene sus propios usuarios, repartidores, paquetes, jornadas, recorridos, configuración, informes y datos. Aislamiento en el **backend** y en la **base de datos**. | ✅ Definitiva |
| D2 | **App del repartidor: primero PWA, después app de tiendas.** Se arranca con una **PWA** (React + TypeScript), instalable desde el navegador, para no tener que publicar en Google Play ni App Store al principio. Más adelante, el **mismo código** se empaqueta con **Capacitor** y se sube a las tiendas (§14.1). Desde el día 1 todo acceso al dispositivo pasa por `DeviceServices`, para que ese paso no implique reescribir. | ✅ Definitiva |
| D3 | **Backend Django + Django REST Framework + PostgreSQL + PostGIS.** El panel y la app comparten backend, autenticación, API y lógica de negocio. | ✅ Definitiva |
| D4 | **GPS por etapas.** Mientras la app sea PWA: ubicación garantizada en cada evento (inicio de jornada, visitas, fotos) y recorrido mientras la app está abierta, con huecos marcados (§4.2). El **recorrido continuo con la pantalla bloqueada** llega con la app nativa de las tiendas. Siempre solo entre el inicio y el fin de la jornada. | ✅ Definitiva |

Descartados: Expo/React Native (código separado del panel, contradice D2) y NestJS/Prisma (contradice D3).

## 1. Resumen de la arquitectura

| Componente | Tecnología | Motivo |
|---|---|---|
| Backend / API | Django 5 + DRF | Auth, ORM, migraciones y admin incluidos |
| Base de datos | PostgreSQL 16 + PostGIS | Consultas geográficas + Row Level Security |
| Tareas asíncronas | Celery + Redis | Importaciones, geocodificación, informes, purgas, notificaciones |
| Tiempo real (panel) | Django Channels (WebSockets) | Mapa en vivo y avisos |
| **App del repartidor** | React + TypeScript + Vite como **PWA** (`vite-plugin-pwa`). En la fase 2, el mismo código se empaqueta con **Capacitor** para las tiendas | Sin tiendas al principio; sin reescribir después |
| GPS en segundo plano (fase 2) | Plugin de Capacitor a elegir cuando se haga la app nativa (§5.4) | Lo único que el navegador no permite |
| Almacenamiento local | Capa `LocalStore`: **SQLite** en la app nativa, **IndexedDB (Dexie)** en la PWA | Ver §5.3 |
| Panel administrativo | React + TypeScript + Vite + TanStack Query/Router/Table (web, instalable como PWA en escritorio) | Online-first |
| Lógica compartida | Paquetes `domain`, `api-client`, `ui` del monorepo | Mismos tipos, validaciones y reglas |
| Mapas | MapLibre GL JS (dentro de la app nativa también) | Open source; permite caché offline |
| Escaneo | Nativo: ML Kit vía plugin de Capacitor. PWA: `BarcodeDetector` o ZXing en WebAssembly | Rendimiento nativo donde se puede |
| Fotos | Nativo: plugin de cámara + sistema de archivos. PWA: cámara del navegador + IndexedDB. Subida a bucket S3 privado | Se conservan hasta confirmar la subida |
| Push | Nativo: FCM (Android) y APNs (iOS). PWA y panel: Web Push (VAPID) | — |

---

## 2. Análisis del alcance

### 2.1 Lo que define el diseño
1. **Multiempresa (D1):** toda tabla, consulta, archivo, canal en tiempo real, tarea y clave de caché lleva la organización. Si falta, no se devuelve nada.
2. **Un código, dos formas de ejecución (D2):** todo acceso al dispositivo (ubicación, cámara, escaneo, almacenamiento, push, red) pasa por la capa **`DeviceServices`**, con una implementación nativa (Capacitor) y otra web (PWA). Las pantallas y la lógica no saben en cuál corren.
3. **Offline-first:** se guarda primero en el teléfono y después se sincroniza.
4. **GPS continuo (D4):** la captura y el envío de los puntos GPS ocurren en la **capa nativa**, sin depender de que la parte web esté activa (§5.4).
5. **Trazabilidad:** los hechos de campo son eventos inmutables con su hora original.
6. **Datos personales y geolocalización de trabajadores:** §11.

### 2.2 Complejidad por funcionalidad
| Baja | Media | Alta |
|---|---|---|
| Login, roles, ABM | Importación CSV/Excel | Aislamiento multitenant con RLS + pruebas |
| Cronómetro (por marcas de tiempo) | Escaneo nativo y web | **GPS continuo en segundo plano** (permisos, batería, fabricantes Android) |
| Llamadas, WhatsApp, navegación externa | Fotos offline con cola de subida | Motor de sincronización e idempotencia |
| Dashboard básico | Push nativo y web | **Aprobación en Google Play y App Store** por ubicación en segundo plano |
| Auditoría | Geocodificación de direcciones argentinas | Mapa offline; optimización de recorrido (etapa 1, OSRM + VROOM) |

---

## 3. Arquitectura multitenant (D1)

### 3.1 Modelo: base compartida, esquema compartido, `organization_id` obligatorio
| Opción | Aislamiento | Costo operativo | Decisión |
|---|---|---|---|
| Una base por empresa | Máximo | Muy alto | No para el inicio |
| Un esquema por empresa (django-tenants) | Alto | Alto | No |
| **Esquema compartido + `organization_id` + RLS** | Alto con las capas de abajo | Bajo; escala a miles de empresas | ✅ Elegida |

Queda prevista una capa de enrutamiento para mover más adelante una empresa grande a una base dedicada.

### 3.2 Capas de aislamiento
1. **Contexto de empresa en cada request:** se toma de la membresía activa del usuario autenticado, verificada en el servidor. Nunca de un parámetro del cliente.
2. **ORM que falla cerrado:** los modelos heredan de `TenantModel`; sin contexto de empresa, lanza error. El acceso entre empresas solo existe para tareas de plataforma, es explícito y queda auditado.
3. **Row Level Security en PostgreSQL:** política `organization_id = current_setting('app.current_org')::uuid` en cada tabla; el backend usa un rol sin `BYPASSRLS` y que no es dueño de las tablas; el valor se fija con `SET LOCAL` en cada transacción (compatible con PgBouncer en modo transacción); las migraciones usan otro rol.
4. **Claves foráneas compuestas** con `organization_id`, para que sea imposible relacionar registros de empresas distintas. Unicidad siempre con la empresa: `(organization_id, tracking_code)`.
5. **Archivos:** prefijo `org/<org_id>/…` en el bucket; URLs firmadas de pocos minutos, generadas después de verificar permisos.
6. **Todo lo demás:** claves de Redis, grupos de WebSocket, tareas de Celery (fijan el contexto antes de ejecutar), exportaciones, suscripciones push, logs.
7. **UUID** en toda la API.
8. **Ingesta de GPS:** cada lote de puntos se asocia a la empresa por el token del dispositivo y la jornada activa, **nunca** por un campo que manda el teléfono.

### 3.3 Roles de plataforma vs. roles de empresa
- **Empresa:** Dueño, Administrador, Supervisor, Repartidor (§8).
- **Plataforma** (equipo de RouteControl): gestiona empresas y planes; **no** ve datos operativos salvo con un acceso de soporte temporal, aprobado por el dueño y auditado.

### 3.4 Ciclo de vida de una empresa
Alta (en el MVP la hace el equipo de plataforma; autogestionada en la etapa 2), invitaciones por email, límites por plan (repartidores, almacenamiento, geocodificaciones), *rate limiting* por empresa, suspensión, exportación de datos y baja según la política de retención.

### 3.5 Dominios
Subdominios por interfaz, no por empresa: `app.<dominio>` (PWA), `panel.<dominio>`, `api.<dominio>`. La app nativa habla directamente con `api.`. La empresa se determina por la sesión.

### 3.6 Pruebas obligatorias de aislamiento
Prueba parametrizada sobre **todos** los endpoints con un usuario de otra empresa (debe dar 404), pruebas SQL de RLS y prueba de que el ORM sin contexto falla. Corren en CI y bloquean el merge.

---

## 4. Capacidades por plataforma (investigadas en octubre de 2026)

### 4.1 Tabla comparativa
| Capacidad | App nativa Android (Capacitor) | App nativa iOS (Capacitor) | PWA Android | PWA iOS (instalada) |
|---|---|---|---|---|
| Instalación | Google Play, o distribución privada | App Store, o distribución privada (§6.2) | Aviso de instalación del navegador | Manual: *Compartir → Agregar a inicio* |
| **GPS con pantalla bloqueada / segundo plano** | **Sí**, con servicio en primer plano y notificación visible | **Sí**, con modo de ubicación en segundo plano (indicador azul en la barra de estado) | No | No |
| Envío de puntos en segundo plano | Sí, desde la capa nativa (la parte web se ralentiza tras unos minutos en segundo plano) | Sí, desde la capa nativa | No | No |
| Sincronización de la cola de negocio en segundo plano | Parcial (al reabrir y con tareas nativas) | Al reabrir la app | Sí (Background Sync) | No |
| Escaneo | ML Kit nativo | ML Kit nativo | `BarcodeDetector` | ZXing en WebAssembly |
| Cámara y fotos | Nativa | Nativa | Navegador | Navegador |
| Push | FCM | APNs | Web Push | Web Push, solo instalada |
| Almacenamiento local | SQLite + archivos | SQLite + archivos | IndexedDB | IndexedDB (no se borra a los 7 días si está instalada) |
| Actualizaciones | Tienda (código nativo) + actualización del código web (§6.3) | Ídem | Inmediatas | Inmediatas |

### 4.2 Qué se promete en cada modo
**App nativa (fase 2, cuando se publique en las tiendas):**
- ✅ Recorrido GPS continuo entre "Iniciar jornada" y "Finalizar jornada", también con la pantalla bloqueada o con el repartidor en WhatsApp o en una llamada.
- ✅ Notificación permanente "RouteControl está registrando tu recorrido" mientras dure la jornada (Android la exige; iOS muestra su propio indicador).
- ⚠️ Algunos fabricantes de Android (Xiaomi, Samsung, Huawei, Motorola y otros) cierran apps en segundo plano para ahorrar batería. Se mitiga con una guía de configuración dentro de la app y se detecta con huecos en el recorrido, que se muestran como tales.
- ⚠️ Si el repartidor cierra la app a la fuerza (deslizándola en el selector de apps), el sistema puede detener el seguimiento. Al reabrirla, se reanuda y el hueco queda registrado.

**PWA (fase 1, la que se construye ahora):** las mismas pantallas, con ubicación solo en cada evento y mientras la app está abierta, y con huecos explícitos. Las jornadas hechas desde la PWA quedan marcadas como `tracking_mode = EVENTS_ONLY`, para que los informes no las comparen con las jornadas de recorrido continuo.

**Cronómetro (los dos modos):** se guarda la hora de inicio y el tiempo se calcula al mostrarlo, así que sigue siendo correcto aunque la app quede en segundo plano.

---

## 5. Arquitectura general

```
┌──────────────────────────────────────────────┐  ┌─────────────────────────────┐
│ App del repartidor (apps/driver)             │  │ Panel (apps/admin)          │
│ React + TS — mismas pantallas y lógica       │  │ React + TS                  │
│ ┌──────────── DeviceServices ──────────────┐ │  │ TanStack Query/Router/Table │
│ │ Implementación nativa │ Implementación web│ │  │ MapLibre, gráficos          │
│ │ (Capacitor)           │ (PWA)             │ │  │ WebSocket                   │
│ │ GPS en segundo plano  │ watchPosition     │ │  └──────────────┬──────────────┘
│ │ SQLite + archivos     │ IndexedDB (Dexie) │ │                 │
│ │ ML Kit · cámara · FCM/APNs │ ZXing · Web Push │ │             │
│ └──────────────────────────────────────────┘ │                 │
└──────────────────────┬───────────────────────┘                 │
          paquetes compartidos: domain · api-client · ui         │
                       ▼                                         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ API Django + DRF (api.)  /api/v1  OpenAPI                                │
│ Middleware de empresa → TenantModel → RLS (SET LOCAL)                    │
│ tracking (ingesta de lotes GPS) · sync · paquetes · jornadas · visitas · │
│ evidencias · domicilios · notificaciones · informes · auditoría · geo    │
│ Channels (WebSockets)          Celery                                    │
└──────┬─────────────────────┬────────────────────────┬────────────────────┘
       ▼                     ▼                        ▼
 PostgreSQL + PostGIS      Redis            Bucket S3 privado (org/<id>/…)
 Externos: teselas y geocodificación · FCM · APNs · Web Push · email
```

### 5.1 Dos front-ends en el monorepo
- **`apps/driver`**: una sola app React que se compila para Capacitor (carpetas `android/` e `ios/`) y para la PWA. No contiene código de administración.
- **`apps/admin`**: el panel web.
- Comparten autenticación, cliente de API generado desde OpenAPI, dominio (tipos, enums, validaciones zod, reglas de negocio) y sistema de diseño.

### 5.2 Motor de sincronización (datos de negocio)
- IDs generados en el teléfono (UUIDv7).
- **Outbox local:** cada acción se guarda y se encola en una misma transacción local; un *worker* envía en lotes con reintentos y espera exponencial.
- **Idempotencia** con `client_op_id`.
- **Doble marca de tiempo:** `occurred_at` (teléfono) y `received_at` (servidor); se mide el desfase del reloj del teléfono.
- **Conflictos:** los eventos de campo los decide el repartidor (inmutables); las asignaciones y los datos del paquete los decide el panel; en los casos cruzados se acepta el evento, se alerta al supervisor y queda en auditoría.
- **Descarga incremental:** `GET /sync/pull?since=<cursor>`.
- **Fotos:** se envía el registro, se pide una URL firmada, se sube el archivo, el servidor verifica el hash y recién entonces se borra del teléfono.
- **Disparadores:** al abrir la app, al volver la conexión, al volver al primer plano, después de cada acción y periódicamente mientras está abierta. Al finalizar la jornada se espera a que la cola esté vacía.
- **Indicador:** conectado y actualizado · sin conexión, cambios guardados · sincronizando · sincronización completa · error.

### 5.3 Almacenamiento local (`LocalStore`)
- **App nativa: SQLite** (plugin de SQLite para Capacitor) para la cola, los paquetes de la jornada y el buffer de GPS, y el **sistema de archivos** nativo para las fotos. Se evita depender de IndexedDB dentro de la WebView para datos críticos, porque el sistema operativo puede liberarla cuando falta espacio.
- **PWA: IndexedDB (Dexie)**, con `navigator.storage.persist()`.
- Una misma interfaz con dos implementaciones; el motor de sincronización no cambia.

### 5.4 GPS continuo (D4)
**Flujo:**
1. "Iniciar jornada" → aviso destacado dentro de la app (qué se registra, para qué, que sigue con la app cerrada o la pantalla bloqueada y que termina al cerrar la jornada) → permisos del sistema → se crea la jornada en el servidor → se inicia el seguimiento nativo.
2. La capa nativa guarda cada punto en SQLite y **envía lotes desde código nativo**, sin pasar por la WebView. En Android, después de unos minutos en segundo plano, las peticiones que salen de la WebView se ralentizan, por eso se usa HTTP nativo.
3. Formato del lote: `POST /api/v1/tracking/batch` con `[{point_id (UUID), recorded_at, lat, lng, accuracy, speed, heading, battery, is_moving}]`. Respuesta `{accepted: [ids], duplicates: [ids], rejected: [{id, reason}]}`. El teléfono borra los aceptados y los duplicados; reintentar nunca duplica puntos (`ON CONFLICT (organization_id, point_id) DO NOTHING`).
4. Frecuencia adaptativa: por distancia mientras se mueve; se apaga o espacia cuando está quieto (ahorro de batería).
5. "Finalizar jornada" → se detiene el seguimiento y se envía lo pendiente. **Límite de seguridad:** el seguimiento se detiene solo si la jornada supera una duración máxima configurable (por ejemplo, 14 horas), para no registrar fuera del horario si el repartidor se olvida de cerrarla.
6. El servidor registra los **huecos** (`TrackingGap`) cuando hay saltos de tiempo grandes entre puntos.

**Candidatos para el plugin (se eligen en la prueba de concepto, etapa 0):**
| Plugin | Costo | Pros | Contras |
|---|---|---|---|
| **Transistorsoft** `capacitor-background-geolocation` | Gratis en builds de *debug*; **licencia paga solo para builds de release en Android** | El más maduro: detección de movimiento, buffer SQLite propio y envío HTTP nativo incluidos | Costo de licencia (consultar precio vigente) |
| **Capgo** `@capgo/background-geolocation` | Gratis | Precisión buena según su comparación; geofencing nativo | Hay que construir el buffer y el envío nativos; menos trayectoria |
| **Capacitor Community** `@capacitor-community/background-geolocation` | Gratis | Simple, mantenido por la comunidad | Precisión menor según la comparación de Capgo; buffer y envío propios |

Criterios de elección: puntos recibidos en una jornada real con la pantalla bloqueada (en Android de gama media/baja y en iPhone), consumo de batería, huecos, precisión, esfuerzo de integración y costo. Todo plugin se usa detrás de la interfaz `DeviceServices.location`, para poder cambiarlo.

### 5.5 Mapa y modo offline
> Decidido el 01/11/2026 (ADR-008).

- **Mapa:** MapLibre GL JS en todas las interfaces, con **OpenStreetMap servido desde nuestro propio origen**: teselas en PMTiles, fuentes, íconos y el worker de MapLibre. No depende de otros dominios: no lo frenan los bloqueadores y puede funcionar sin conexión. La etapa 0 cubre la zona AMBA.
- **Sin conexión (etapa 1):** antes de salir, o con Wi-Fi, se guardan en el teléfono las teselas de la zona de los paquetes asignados. Los pines y los datos se dibujan desde el almacenamiento local.
- **Navegar:** el botón abre **Google Maps o Waze** con la dirección, mediante enlaces externos y sin API de Google.
- **Armar mi ruta (etapa 1):** optimización del orden de las paradas con **VROOM** y ruteo con **OSRM**, los dos autoalojados. Calcular la ruta requiere conexión; la ruta calculada queda guardada en el teléfono.

### 5.6 Autenticación
- Email y contraseña (Argon2), recuperación por email, invitaciones, elección de empresa.
- **Web (panel y PWA):** *access token* corto en memoria + *refresh token* rotativo en cookie `httpOnly`, `Secure`, `SameSite`, servida desde `api.`; CSRF.
- **App nativa:** *refresh token* en el almacenamiento seguro del sistema (Keychain en iOS, Keystore en Android) mediante un plugin de almacenamiento seguro; *access token* en memoria.
- **Token del dispositivo para el GPS:** al iniciar la jornada se emite un token de alcance limitado (solo `tracking/batch` para esa jornada, empresa y dispositivo), que la capa nativa usa para enviar puntos aunque la parte web no esté activa. Vence al cerrar la jornada o al alcanzar la duración máxima.
- **Offline:** la app sigue funcionando con los datos locales; al volver la señal renueva el token y envía. Si la sesión expiró, pide login y la cola se envía solo si entra el mismo usuario.

---

## 6. Dependencias externas

### 6.1 Servicios
| Servicio | Para qué | Opciones | Necesitamos de vos |
|---|---|---|---|
| **Licencia del plugin GPS** | GPS en segundo plano en builds de release de Android | Transistorsoft (pago) o plugins gratuitos | Decidir después de la prueba de concepto |
| **Mac con Xcode** | **Compilar la app de iOS** (no se puede desde Windows) | Una Mac propia, una Mac en la nube o CI con runners macOS (GitHub Actions, Codemagic, Ionic Appflow) | Elegir opción |
| **Apple Developer Program** | Instalar en iPhone real, TestFlight, App Store, APNs | USD 99/año | Cuenta (a nombre de la empresa, idealmente) |
| **Google Play Console** | Publicar en Android y pruebas internas | USD 25, pago único | Cuenta |
| **Firebase (FCM)** | Push en Android (y opcionalmente en iOS) | Gratis | Proyecto de Firebase |
| Teselas de mapa | Mapa (también offline) | **PMTiles de OSM autoalojado** (decidido, ADR-008) | Hosting para el archivo (estático, con rangos) |
| Ruteo y optimización | "Armar mi ruta" (etapa 1) | **OSRM + VROOM autoalojados** (decidido, ADR-008) | Un servidor con los datos de OSM de la región |
| Geocodificación | Dirección → coordenadas | Georef (API gratuita del Estado argentino) + respaldo comercial | Cuenta del respaldo |
| Almacenamiento | Fotos e importaciones | AWS S3 · Cloudflare R2 · MinIO (desarrollo) | Cuenta |
| Web Push | PWA y panel | VAPID propio | Nada |
| Email transaccional | Invitaciones, recuperación, alertas | Amazon SES · Resend · SendGrid · SMTP | Dominio + proveedor |
| Dominio y HTTPS | Obligatorio | — | Nombre de dominio |
| Hosting | API, workers, base | VPS + PostgreSQL gestionado, o AWS/GCP en una región cercana | Preferencia |
| Túnel HTTPS (desarrollo) | Que el teléfono en la calle llegue a la API de desarrollo | Cloudflare Tunnel o ngrok | Nada |
| Monitoreo de errores | Backend, app nativa, PWA | Sentry | Opcional |

### 6.2 Publicación y aprobación en las tiendas
- **Google Play:** las apps con ubicación en segundo plano pasan por una **declaración de permisos revisada por Google**. Hay que presentar el formulario, un **video** que muestre la función y un **aviso destacado dentro de la app** antes del permiso del sistema, además de una política de privacidad que mencione la ubicación en segundo plano. La función tiene que ser central para la app (el recorrido de reparto lo es).
  - Alternativa a evaluar: usar solo un **servicio en primer plano** iniciado por el repartidor ("Iniciar jornada"), sin el permiso `ACCESS_BACKGROUND_LOCATION`. Según la guía consultada, en ese caso no haría falta la declaración de ubicación en segundo plano, aunque el uso del servicio en primer plano también se revisa. Se decide en la prueba de concepto.
- **App Store:** revisión de Apple; modo de ubicación en segundo plano declarado y textos de permiso claros. Hay que justificar el uso en la revisión.
- **Distribución privada (opcional, para empresas):** Android admite apps privadas en Google Play administrado o instalación directa del APK en pruebas; iOS admite TestFlight para pilotos y apps personalizadas a través de Apple Business Manager. A confirmar según cada cliente.

### 6.3 Actualizaciones
- Cambios en el código nativo o en los permisos → nueva versión en las tiendas.
- Cambios en las pantallas y la lógica (la parte web) → pueden distribuirse como actualización del código web dentro de la app (Capgo, Ionic Appflow o una solución propia), respetando las políticas de las tiendas. Se evalúa en la etapa 2.

---

## 7. Modelo de datos

Convenciones: todas las tablas operativas tienen `id` UUID, **`organization_id` NOT NULL** con RLS, `created_at`, `updated_at`. Lo creado en el teléfono suma `occurred_at` (o `recorded_at`), `received_at` y un identificador del cliente único. Coordenadas `geography(Point, 4326)`. Claves foráneas compuestas con `organization_id`.

### 7.1 Plataforma (sin RLS de empresa)
- **Organization:** `id, name, slug, tax_id (CUIT), plan_id, limits, settings (umbrales, retención, notificaciones, duración máxima de jornada), status, timezone`
- **Plan:** `id, name, max_drivers, storage_gb, features`
- **User:** `id, email (único), password (Argon2), full_name, phone, status, is_platform_staff, last_login`
- **PlatformSupportGrant:** `id, organization_id, staff_user_id, approved_by, expires_at, reason`

### 7.2 Empresa (con RLS)
- **Membership:** `id, organization_id, user_id, role (OWNER | ADMIN | SUPERVISOR | DRIVER), permissions, status`
- **Invitation:** `id, organization_id, email, role, token_hash, expires_at, accepted_at`
- **DriverProfile:** `id, organization_id, membership_id, employee_code, document_number (cifrado), hire_date, vehicle_type, status`
- **Device:** `id, organization_id, driver_id, runtime (NATIVE_ANDROID | NATIVE_IOS | PWA), model, os_version, app_version, location_permission (always | while_in_use | denied), battery_optimization_disabled, push_token, last_sync_at, clock_offset_ms`
- **PushSubscription:** `id, organization_id, user_id, channel (FCM | APNS | WEBPUSH), token_o_endpoint, keys, last_success_at`
- **Address:** `id, organization_id, raw_text, street, number, floor_unit, locality, province, postal_code, normalized_key, location, geocode_provider, geocode_confidence, location_corrected_by, reception_stats`
- **Package:** `id, organization_id, tracking_code, source, recipient_name, recipient_phone, address_id, notes, status, assigned_driver_id, assigned_at, workday_id, import_job_id, version`. Estados: `CREATED → ASSIGNED → IN_ROUTE → DELIVERED | FAILED | RESCHEDULED | RETURNED | CANCELLED`.
- **PackageEvent** (append-only): `id, organization_id, package_id, type, from_status, to_status, actor_user_id, payload, occurred_at`
- **Workday:** `id, organization_id, driver_id, device_id, date, started_at, ended_at, start_location, end_location, status (NOT_STARTED | ACTIVE | FINISHED | FORCE_CLOSED | AUTO_CLOSED), close_reason, tracking_mode (CONTINUOUS | EVENTS_ONLY), summary`
- **TrackingToken:** `id, organization_id, workday_id, device_id, token_hash, expires_at, revoked_at`
- **LocationPoint:** `point_id (UUID del teléfono), organization_id, workday_id, driver_id, device_id, location, accuracy_m, speed, heading, altitude, battery, is_moving, source (BACKGROUND | FOREGROUND | EVENT), recorded_at, received_at`. Único: `(organization_id, point_id)`. Índices: GiST en `location`, `(workday_id, recorded_at)`. El particionado por mes se posterga hasta que el volumen lo justifique (exige incluir `recorded_at` en la clave única).
- **TrackingGap:** `id, organization_id, workday_id, from_at, to_at, reason (sin_señal | app_cerrada | permiso_revocado | optimizacion_bateria | desconocido)`
- **RouteStop:** `id, organization_id, workday_id, package_id, sequence, source`
- **Visit:** `id, organization_id, package_id, address_id, workday_id, driver_id, started_at, ended_at, duration_s, start_location, end_location, outcome, outcome_attribution (RECIPIENT | LOGISTIC | NONE), notes, is_second_attempt, voided, voided_reason`

| Resultado | Atribución |
|---|---|
| Entregado correctamente | NONE (éxito) |
| Destinatario ausente | RECIPIENT |
| Nadie responde | RECIPIENT |
| Cliente solicita reprogramación | RECIPIENT (peso menor) |
| Dirección incorrecta | LOGISTIC |
| Acceso imposible | LOGISTIC |
| Otro inconveniente | La elige el repartidor |

- **Incident:** `id, organization_id, package_id, visit_id, driver_id, type, description, status, resolved_by, resolved_at`
- **Evidence:** `id, organization_id, visit_id, package_id, address_id, driver_id, reason, storage_key, mime, size, sha256, location, captured_at, upload_status (PENDING | UPLOADED | VERIFIED)`
- **Communication:** `id, organization_id, package_id, visit_id, driver_id, channel (PHONE | WHATSAPP | VOIP), started_at, result`
- **SecondAttemptRequest** (etapa 2): `id, organization_id, package_id, requested_at, requested_window, distance_m, detour_s, pending_count, suggestion, decision, decided_by`
- **ImportJob:** `id, organization_id, file_key, column_mapping, status, total_rows, ok_rows, error_rows, errors`
- **Notification:** `id, organization_id, recipient_user_id, type, title, body, payload, channels_sent, read_at`
- **SyncReceipt:** `client_op_id, organization_id, device_id, entity_type, entity_id, processed_at`
- **AuditLog** (append-only): `id, organization_id, actor_user_id, action, entity_type, entity_id, changes, ip, user_agent, occurred_at`

### 7.3 Indicador de recepción del domicilio (etapa 2)
Solo cuentan los éxitos y las fallas atribuibles al destinatario. Peso por antigüedad `0,5 ^ (días / 30)`. Gris con menos de 3 visitas computables; verde ≥ 80 %, amarillo 40–80 %, rojo < 40 %; configurable por empresa. Informativo: nunca descarta una entrega.

---

## 8. Roles y permisos
Siempre en el backend, después del filtro por empresa.

| Permiso | Dueño | Admin | Supervisor | Repartidor |
|---|:-:|:-:|:-:|:-:|
| Configurar empresa y plan | ✔ | — | — | — |
| Crear admins y supervisores | ✔ | — | — | — |
| Invitar y dar de baja repartidores | ✔ | ✔* | — | — |
| ABM e importación de paquetes | ✔ | ✔ | ✔* | — |
| Asignar paquetes | ✔ | ✔ | ✔ | — |
| Ver ubicación y recorrido durante la jornada | ✔ | ✔ | ✔ | propio |
| Ver fotos e incidencias | ✔ | ✔ | ✔ | propias |
| Informes | ✔ | ✔ | ✔* | propios |
| Auditoría | ✔ | ✔* | — | — |
| Operar jornada y visitas | — | — | — | ✔ |
| Aprobar acceso de soporte | ✔ | — | — | — |

\* configurable por el dueño.

---

## 9. Navegación

### 9.1 Panel (`panel.`)
```
/login  /recuperar  /restablecer/:token  /invitacion/:token  /elegir-empresa
/                       Dashboard
/operaciones/mapa       Mapa en vivo (posición actual de los repartidores en jornada)
/repartidores  /repartidores/:id
/paquetes  /paquetes/nuevo  /paquetes/importar  /paquetes/:id
/jornadas/:id           Informe y recorrido (con huecos marcados)
/visitas
/domicilios/:id                                   (etapa 2)
/informes                                         (etapa 2)
/notificaciones
/configuracion/empresa | usuarios | roles | notificaciones | retencion | soporte
/auditoria
/plataforma/*           Solo para el equipo de RouteControl
```

### 9.2 App del repartidor (nativa y PWA)
```
/bienvenida             Onboarding: permisos (ubicación "siempre", cámara, notificaciones),
                        guía de batería para el fabricante del teléfono
/login  /recuperar
/                       Inicio: resumen, Iniciar/Finalizar jornada, estado de GPS y de sincronización
/paquetes  /paquetes/:id
/visita/:id             Cronómetro → resultado → foto
/escanear
/mapa
/perfil                 Historial propio, permisos del dispositivo, diagnóstico, cerrar sesión
/instalar               Solo en la PWA: cómo instalar o descargar la app nativa
```

---

## 10. Experiencia de usuario y diseño visual

### 10.1 Tokens visuales
> Actualizado el 01/11/2026 (v0.5.2, ADR-007 v2): **tema oscuro de las maquetas aprobadas por el cliente** (`docs/diseno/`, que son la especificación visual obligatoria). Reemplaza la paleta clara de la v0.5.1.
>
> La fuente de verdad es `packages/ui/src/tokens.ts`. Las pruebas verifican:
> - el contraste de cada par: WCAG AA como mínimo, y 7:1 en el texto principal y secundario;
> - que estén todos los colores del README de las maquetas.

| Token | Valor | Uso | Contraste |
|---|---|---|---|
| Fondo | `#070B1F` | Fondo de las pantallas | Texto principal encima: 17,9:1 |
| Superficie | `#11183A` | Tarjetas, campos, barra inferior | Texto secundario encima: 7,9:1 |
| Superficie 2 | `#1A2350` | Chips, botones secundarios, avatares | — |
| Barra lateral / mapa | `#0B1130` / `#0C1230` | Panel / fondo del mapa | — |
| Bordes | `#1F2860`, `#2A3470` | Tarjetas y separadores (decorativos) | — |
| Borde de campos | `#5A67B0` | Contorno de los campos de formulario | 3,3:1 sobre la tarjeta (≥ 3:1) |
| Texto principal | `#F3F5FF` | Títulos, cifras | 17,9:1 |
| Texto secundario fuerte | `#D5DBF7` | Etiquetas | 12,6:1 sobre la tarjeta |
| Texto secundario | `#A3AED6` | Detalles | 8,9:1 sobre el fondo |
| **Acción principal** | violeta `#7C5CFF` (presionado y botones chicos: `#6B4BF0`) | Botones principales, foco | Blanco: 4,3:1 (texto grande, ≥ 19 px en negrita); 5,4:1 en `#6B4BF0` |
| Acentos | violeta claro `#A78BFA` / `#C4B5FD`; azul `#4D8DFF` / `#7FB0FF` | Enlaces, ítem activo, etiquetas | 7,2:1 / 9,4:1 / — / 7,9:1 |
| Marca | `linear-gradient(140deg, #4D8DFF, #7C5CFF)` | Solo logo, avatares y tarjeta destacada | — |
| Éxito | `#34D399` / texto `#6EE7B7` | Registrando, conectado, permitido | 11,3:1 |
| Atención | `#FBBF24` / texto `#FCD34D` | Sin señal, en pausa, pendientes | 12,0:1 |
| Sin datos (huecos) | `#FB923C` / texto `#FDBA74` | Huecos en el mapa y en los resúmenes | 8,1:1 sobre el mapa |
| Error | `#F87171` / texto `#FCA5A5` | Errores (no está en las maquetas, ADR-007) | 9,1:1 |
| Recorrido en el mapa | `#8B5CF6` | Tramos registrados | 4,3:1 sobre el mapa (gráfico: ≥ 3:1) |

**Tipografía y forma:**
- **Fuente:** Plus Jakarta Sans de 400 a 800, empaquetada con la app para que funcione sin conexión. Los cronómetros y las cifras usan números tabulares.
- **Tamaños:** el texto base es de 15 a 16 px. Los campos usan 17 px para que iOS no haga zoom al enfocarlos.
- **Radios:** 16 px en los campos, 18 px en los botones y las tarjetas chicas, y 24 px en las tarjetas grandes y la barra inferior.
- **Alturas:** 60 a 64 px en la acción principal; 56 px en los campos y los botones secundarios.

**Animaciones:**
- bienvenida de unos 2 s: el logo, la ruta que se dibuja, el nombre y el lema;
- entrada suave del login;
- pulso del botón "Iniciar jornada";
- punto "en vivo" mientras se registra el recorrido.

Con "reducir movimiento" (`prefers-reduced-motion`) no hay animaciones.

### 10.2 App para usar en la calle
- Botones principales de al menos 56 px en la zona del pulgar; texto de 16 px como mínimo; alto contraste.
- Flujo de visita en 3 toques.
- Estado del GPS ("Registrando recorrido", "Recorrido en pausa", "Ubicación bloqueada") y de la sincronización siempre visibles, como pastillas en el encabezado.
- **Pantalla de diagnóstico** en Perfil: permisos, optimización de batería, puntos pendientes de envío, última sincronización. Sirve para soporte.

### 10.3 Panel
Barra lateral, encabezado con buscador por código, tarjetas, tablas con filtros, gráficos, mapas, modales y formularios simples; responsive.

---

## 11. Seguridad, privacidad y normativa argentina

> No es asesoramiento legal. Conviene una revisión de un abogado especializado antes de operar con datos reales.

- **Ley 25.326:** finalidad informada, minimización, derechos de acceso, rectificación y supresión, evaluación de la inscripción de las bases ante la AAIP; reglas de transferencia internacional si el hosting está fuera de Argentina.
- **SaaS:** cada empresa cliente es responsable de sus datos y RouteControl es encargado del tratamiento; hace falta un contrato o anexo de tratamiento de datos.
- **Relación laboral y GPS continuo:** el control debe ser proporcional y respetar la dignidad del trabajador.
  - El seguimiento **solo** existe entre el inicio y el fin de la jornada, con corte automático por duración máxima.
  - Aviso destacado antes de pedir permisos y notificación visible durante toda la jornada.
  - El repartidor puede ver su propio recorrido registrado.
  - **Teléfonos personales:** si el repartidor usa su propio celular, es todavía más importante que el seguimiento no se extienda fuera del horario. Conviene una política interna de la empresa firmada por el trabajador.
- **Técnicas:** HTTPS con HSTS; RLS; cifrado en reposo; cifrado de campos sensibles; URLs firmadas cortas; *rate limiting*; bloqueo por intentos fallidos; Content Security Policy; tokens en el almacenamiento seguro del sistema; auditoría de accesos a fotos y recorridos.
- **Datos en el teléfono:** solo los de la jornada actual; se borran al cerrar y sincronizar.
- **Retención configurable** (propuesta): puntos GPS 90 días, fotos 180 días, visitas y auditoría 2 años; purga automática.
- **Historial de domicilios** sin etiquetas permanentes.

---

## 12. Riesgos técnicos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Fabricantes de Android que cierran apps en segundo plano | Huecos en el recorrido | Probar en gama media/baja en la etapa 0; guía de batería por fabricante; detección de huecos; alerta en el panel |
| Rechazo o demora en Google Play / App Store por la ubicación en segundo plano | Demora en la salida | Aviso destacado, video, política de privacidad; evaluar el servicio en primer plano sin `ACCESS_BACKGROUND_LOCATION`; distribución privada mientras tanto |
| Compilar iOS sin Mac | Bloquea las pruebas en iPhone | Mac propia, Mac en la nube o CI macOS (decidir antes de la etapa 0) |
| Costo de la licencia del plugin | Costo fijo | Comparar con plugins gratuitos en la prueba de concepto |
| Consumo de batería | Teléfono descargado a mitad de jornada | Frecuencia adaptativa y detección de movimiento; medir en la etapa 0 |
| Ralentización de la WebView en segundo plano (Android) | Puntos que no se envían | Buffer y envío HTTP desde la capa nativa |
| Diferencias entre la app nativa y la PWA | Bugs en un solo modo | Capa `DeviceServices` con pruebas para cada implementación; lógica de negocio en `domain` |
| Fuga de datos entre empresas | Crítico | Middleware + ORM que falla cerrado + RLS + claves foráneas compuestas + pruebas que bloquean el merge |
| Builds nativos en Windows con rutas con espacios o largas | Fallas de Gradle | Repo en una ruta corta sin espacios (por ejemplo `C:\dev\routecontrol`) |
| Condiciones de uso de teselas para offline | Mapa offline no permitido | PMTiles de OSM autoalojado |
| Geocodificación de direcciones argentinas | Pines mal ubicados | Georef + respaldo, nivel de confianza, corrección manual |
| Hora del teléfono incorrecta | Eventos con hora errónea | Medir el desfase y alertar; reloj monotónico para duraciones |

---

## 13. Estructura de carpetas (monorepo)

```
routecontrol/                      # ruta corta y sin espacios
├── CLAUDE.md                      # contexto para las sesiones de desarrollo
├── backend/
│   ├── config/
│   ├── apps/
│   │   ├── tenancy/               # Organization, Plan, middleware, TenantModel, RLS
│   │   ├── accounts/
│   │   ├── platform/
│   │   ├── drivers/               # incluye Device
│   │   ├── tracking/              # ingesta de lotes GPS, TrackingToken, huecos
│   │   ├── addresses/
│   │   ├── packages/
│   │   ├── workdays/
│   │   ├── visits/
│   │   ├── evidence/
│   │   ├── sync/
│   │   ├── geo/
│   │   ├── notifications/
│   │   ├── reports/
│   │   └── audit/
│   ├── sql/rls/
│   └── tests/                     # incluye tests/tenancy/
├── apps/
│   ├── driver/                    # React + Capacitor + PWA
│   │   ├── android/               # proyecto nativo (Capacitor)
│   │   ├── ios/                   # proyecto nativo (Capacitor)
│   │   ├── capacitor.config.ts
│   │   └── src/{app,routes,features,device/{native,web},store/{sqlite,indexeddb},sync}
│   └── admin/
├── packages/
│   ├── domain/
│   ├── api-client/
│   ├── ui/
│   └── config/
├── infra/
│   ├── docker-compose.yml         # postgres+postgis, redis, minio, mailpit
│   └── deploy/
├── docs/
│   ├── 01-planificacion-routecontrol.md   # este documento
│   ├── adr/                       # ADR-001 multitenant, ADR-002 PWA+Capacitor, ADR-003 plugin GPS…
│   └── setup.md
├── .env.example
└── README.md
```

Herramientas: pnpm workspaces, Docker Compose, pytest + factory_boy, Vitest, Playwright, GitHub Actions (con runner macOS para iOS si se elige esa opción). Para Android: Android Studio con su JDK y SDK.

---

## 14. Etapas de desarrollo

### Etapa 0 — Fundaciones + validación de la PWA en teléfonos reales
**Objetivo:** tener la base multitenant funcionando y comprobar en los teléfonos que la PWA hace lo que necesitamos. No requiere Mac ni cuentas de las tiendas.

1. Monorepo mínimo + Docker Compose (PostGIS, Redis).
2. **Backend Django multitenant:** `tenancy` (Organization, TenantModel, RLS), usuarios de prueba de dos empresas, login, inicio y fin de jornada, `POST /api/v1/tracking/batch` idempotente, pruebas de aislamiento sobre estos endpoints.
3. **`apps/driver` como PWA:** instalable, Service Worker, IndexedDB (Dexie), capa `DeviceServices` (implementación web), login, Iniciar/Finalizar jornada, ubicación por evento y con la app abierta, cola de envío con reintentos, indicador de sincronización.
4. Página simple para ver el recorrido de una jornada en un mapa MapLibre (con huecos marcados).
5. **Pruebas en teléfonos reales** (varios Android, iPhone 15 y 13): instalación, cámara, escaneo de etiquetas reales, ubicación, fotos guardadas offline y enviadas después, modo avión, Wake Lock, notificaciones.
6. **Informe** con lo que funcionó y lo que no en cada teléfono.

**Criterio de salida:** la PWA se instala y funciona offline en Android y en iPhone; los datos llegan sin duplicados y con la hora original; el aislamiento entre empresas está demostrado.

### Etapa 1 — Fundaciones completas + MVP
1. Completar autenticación, invitaciones, roles y permisos; OpenAPI y cliente TS; paquete `domain`; esqueleto del panel; PWA del repartidor (misma app, implementación web de `DeviceServices`).
2. **Panel:** usuarios → repartidores → paquetes (ABM + importación con mapeo de columnas) → asignación → dashboard → mapa en vivo → visitas, incidencias e historial.
3. **App:** paquetes → escaneo → mapa (caché de zona) → ficha → visita con cronómetro → resultado → fotos → llamadas, WhatsApp y "Navegar" (enlaces a Google Maps o Waze).
4. **"Armar mi ruta":** optimización del orden de las paradas con VROOM y ruteo con OSRM, autoalojados (antes estaba en la etapa 2; ADR-008).
5. Sincronización completa, notificaciones (in-app, tiempo real, push nativo y web).
6. **Lanzamiento como PWA** para las primeras empresas (§14.1, fase 1).
7. Pruebas de punta a punta con dos empresas en paralelo.

### 14.1 Plan de lanzamiento de la app del repartidor

| Fase | Canal para los repartidores | GPS | Requiere |
|---|---|---|---|
| **1. PWA (etapas 0, 1 y 2)** | PWA instalada desde el navegador (`app.<dominio>`) | Por evento y con la app abierta (con huecos marcados) | Solo dominio y hosting |
| **2. App de tiendas (cuando se decida)** | El mismo código empaquetado con Capacitor, en Google Play y App Store | Continuo, también con la pantalla bloqueada | Mac para iOS, cuentas de las tiendas, aprobación por ubicación en segundo plano |

- El paso a la fase 2 no implica reescribir: se agrega la implementación nativa de `DeviceServices` y los proyectos de Android e iOS.
- Cuando se decida, se puede arrancar por Android (no necesita Mac) y sumar iOS después.
- Las jornadas hechas desde la PWA quedan marcadas como `tracking_mode = EVENTS_ONLY`, para que los informes no las comparen con las de recorrido continuo.
- Antes de la fase 2 hay que resolver las cuentas de las tiendas (§15.2).

### Etapa 2 — Funciones avanzadas + operación SaaS
Historial e indicador de domicilios, segundo intento, informes con exportación, alertas configurables, cierre automático de recorrido, actualizaciones del código web dentro de la app, registro autogestionado de empresas, límites por plan, exportación y baja de empresa.

### Etapa 3 — Integraciones
Plataformas logísticas con API oficial, VoIP, WhatsApp Business, ruteo con tránsito, analítica avanzada, cobro de suscripciones.

Cada etapa cierra con el resumen de control de avance (qué se hizo, archivos, qué funciona, qué falta, credenciales, pruebas, problemas, siguiente paso).

---

## 15. Decisiones tomadas y pendientes

### 15.1 Tomadas (31/10/2026)
| Tema | Decisión | Consecuencia |
|---|---|---|
| Mac para iOS | Se puede conseguir, pero **no por ahora** | No bloquea nada: la PWA no necesita Mac. Hace falta recién para la app de iOS en la fase 2 (§14.1). |
| Teléfonos de prueba | **Varios Android**; **iPhone 15 y iPhone 13** | Android: probar al menos uno de gama media/baja y fabricantes distintos. iOS: los dos iPhone sirven desde ya para probar la PWA. |
| Nombre y dominio | **"RouteControl" es un nombre provisorio**; todavía no hay dominio | El nombre, los textos de marca, el manifiesto de la PWA y los dominios se leen de la configuración (variables de entorno), sin escribirlos en el código. Para las pruebas se usa un túnel HTTPS. |
| Titular de las cuentas | **Camila Copo** y la empresa **CLB Developers** | Ver §15.2: conviene definir ya si las cuentas de las tiendas van a nombre de la empresa. |

### 15.2 Cuentas de las tiendas: persona o empresa
No hace falta ahora: recién para la fase 2 (§14.1). Pero el tipo de cuenta cambia los plazos, así que conviene saberlo de antemano.

| | Cuenta personal (Camila Copo) | Cuenta de organización (CLB Developers) |
|---|---|---|
| **Google Play** | Las cuentas personales nuevas deben hacer una **prueba cerrada con al menos 12 testers durante 14 días seguidos** antes de poder publicar | **Exenta** de esa prueba. Requiere número **D-U-N-S** (gratuito) |
| **App Store** | Aparece el nombre legal de la persona como vendedor | Aparece la empresa como vendedor. Requiere **D-U-N-S**, que la empresa sea una persona jurídica, un sitio web y un email del dominio de la empresa |
| Costo | USD 25 (Google, único) + USD 99/año (Apple) | Igual |

**Recomendación:** si CLB Developers es una sociedad registrada (por ejemplo SAS o SRL, con CUIT propio), abrir **las dos cuentas a nombre de la empresa** y **pedir ya el número D-U-N-S**, porque puede tardar días o semanas. Si CLB Developers no es una sociedad (por ejemplo, actividad como monotributista), Apple exige cuenta individual y en Google la cuenta personal implica la prueba de 12 testers y 14 días; en ese caso hay que planificar esa prueba al inicio de la fase 2.

Mientras RouteControl sea PWA **no hace falta ninguna cuenta de las tiendas**.

### 15.3 Pendientes
1. **CLB Developers:** ¿es una sociedad registrada? ¿Tiene sitio web y email con dominio propio?
2. ~~**Teselas de mapa:** ¿aprobás PMTiles de OSM autoalojado?~~ Aprobado el 01/11/2026 (ADR-008).
3. **Dominio y hosting.**
4. **Archivo de importación de ejemplo** y **etiquetas reales** para probar el escaneo.
5. **Repositorio de GitHub.**

---

## Fuentes (consultadas el 31/10/2026)
- Transistorsoft — capacitor-background-geolocation: https://github.com/transistorsoft/capacitor-background-geolocation
- Capacitor Community — background-geolocation: https://github.com/capacitor-community/background-geolocation
- npm — @capacitor-community/background-geolocation: https://npmjs.com/package/@capacitor-community/background-geolocation
- Capgo — capacitor-background-geolocation: https://github.com/Cap-go/capacitor-background-geolocation
- Google Play — Ubicación en segundo plano: https://support.google.com/googleplay/android-developer/answer/9799150?hl=en
- Radar — Play Store background location approval: https://radar.com/blog/guide-to-play-store-background-location-approval
- MDN — Storage quotas and eviction criteria: https://developer.mozilla.org/en/docs/Web/API/IndexedDB_API/Browser_storage_limits_and_eviction_criteria
- Can I use — BarcodeDetector: https://caniuse.com/mdn-api_barcodedetector
- MobiLoud — Do PWAs work on iOS? (2026): https://www.mobiloud.com/blog/progressive-web-apps-ios/
- Mittl Medien — PWA on iOS: https://mittl-medien.de/progressive-web-app-ios
- Synthetixis — PWA on iPhone in 2026: https://synthetixis.com/writing/pwa-ios-2026
