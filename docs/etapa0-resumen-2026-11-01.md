# Resumen del trabajo del 01/11/2026 (sin supervisión)

Pedido: (1) el error del mapa en el iPhone; (2) el sistema de diseño azul y violeta; (3) aplicarlo a la PWA; (4) el panel administrativo. Todo quedó en ramas (nunca en `main`), con commit y push al terminar cada parte y todas las pruebas pasando antes de cada push.

## Ramas (en orden: cada una sale de la anterior)

| Rama | Qué tiene |
|---|---|
| `etapa-0/backend` | Backend Django. Incluye los endpoints nuevos de solo lectura para el panel |
| `etapa-0/driver` | PWA del repartidor, con el arreglo del mapa (parte 1) |
| `etapa-0/diseno` | `packages/ui` (sistema de diseño) y la PWA con el diseño nuevo (partes 2 y 3) |
| `etapa-0/admin` | Panel administrativo y `packages/api-client` (parte 4). **Es la rama que tiene todo** |

Para integrar a `main`, revisar y fusionar en ese orden (backend → driver → diseno → admin), o directamente `etapa-0/admin`, que contiene a las demás.

## 1. Error del mapa en el iPhone (12:59)

- **Causa:** el túnel de Cloudflare se cortó unos 9 s (de 12:59:02 a 12:59:11, `timeout: no recent network activity`). `GET /workdays/{id}/track` nunca llegó a Django; por eso no aparece en sus logs.
- **Descartados:** errores de la API (500, 401, 403), de MapLibre (no hay CSP y las teselas responden) y de Safari.
- **Bug de la pantalla:** el error y "Cargando…" eran dos estados independientes, por eso se veían juntos. Ahora cada carga tiene un estado único:
  - cargando, error (con **Reintentar**) o datos;
  - una respuesta vieja no pisa a la actual.
- **Mejora:** las lecturas (GET) se reintentan una vez solas si falla la red o el túnel (502, 503, 504, 530), así que un corte breve ya no se ve.
- **Pruebas:**
  - solo el error con Reintentar (en el listado y en el recorrido);
  - un corte breve se absorbe sin mostrarse;
  - un error 500 muestra su código;
  - un GET se reintenta una vez y un POST no.

## 2. Sistema de diseño (`packages/ui`)

- **Paleta:**
  - azul `#1D4ED8` para las acciones y `#0B1F4D` para la marca y la barra lateral;
  - violeta `#6D28D9` y `#7C3AED` como acento: elemento activo, foco y **el recorrido en el mapa**;
  - neutros fríos y estados en tonos oscuros sobre fondos suaves.
- **Contraste:** el mínimo es AA. En el texto que se lee en la calle apunté a 7:1 (AAA), por la luz del sol: el texto secundario quedó en 7,0:1, contra el 4,8:1 del gris anterior.
- **Pruebas de la paleta:** verifican 24 pares de colores, que `styles.css` coincida con `tokens.ts` y que no haya quedado el ámbar.
- **Componentes:** `Button`, `TextField`, `Checkbox`, `Card`, `Alert`, `StatusLine`, `Badge`, `Stats`, `LoadingState`, `EmptyState`, `ErrorState` y `Loadable` (cargando, vacío, error y datos, mutuamente excluyentes), más `useLoad`, los formatos es-AR y el mapa compartido (`@routcontrol/ui/map`).
- **Tipografía:** Inter, empaquetada con la app para que funcione sin conexión.
- **Documentación:** §10.1 de la planificación actualizado (v0.5.1) y [ADR-007](adr/ADR-007-paleta-y-sistema-de-diseno.md).

## 3. PWA del repartidor con el diseño nuevo

- Todas las pantallas lo usan: login, elegir empresa, inicio y jornada, GPS, sincronización, aviso de privacidad, diagnóstico, instalación, "Mis recorridos" y mapa.
- **Tamaños:** botones grandes (72 px la acción principal, 56 px el resto) y campos de 17 px, para que iOS no haga zoom al enfocarlos.
- **Estados de cada pantalla:**
  - apertura de la app;
  - jornada que se está recuperando (sin botón principal hasta saber si hay una en curso, porque antes mostraba "Iniciar jornada" deshabilitado);
  - registro del diagnóstico vacío;
  - sin jornadas;
  - jornada sin ubicaciones;
  - errores con Reintentar en el listado, el recorrido y el mapa.
- El GPS detenido es un botón que abre el diagnóstico. La empresa de demostración se marca como tal.
- **Precache:** quedó en 520 KiB. MapLibre y las variantes de Inter que el español no usa se descargan solo si hacen falta.

## 4. Panel administrativo (`apps/admin`)

- **Acceso:** login solo para dueño, admin y supervisor. Un repartidor recibe una explicación y no entra.
- **Estructura:**
  - barra lateral: Inicio, Jornadas y Repartidores;
  - encabezado: empresa, marca de demo, usuario, rol y Salir.
- **Pantallas, todas con datos reales:**
  - **Inicio:** jornadas de hoy y un resumen (en curso, finalizadas, sin señal hace más de 10 min y repartidores con jornada).
  - **Jornadas:** por día, con calendario. Cada una abre su recorrido: resumen, mapa y huecos.
  - **Repartidores:** estado (en jornada, sin señal, sin jornada o de baja), jornada en curso y última jornada, con enlaces.
- **Sin relleno:** no hay botones sin función ni secciones de "próximamente". Cada pantalla tiene sus estados de carga, vacío y error.
- **Backend nuevo** (solo lectura, en `etapa-0/backend`):
  - `GET /api/v1/drivers`;
  - `point_count` y `last_point_at` en el listado de jornadas;
  - `organization.is_demo` en el login y en `me`.
  - Pruebas de aislamiento: el listado de B nunca muestra a los de A, y un repartidor recibe 403.
- **Cliente compartido:** `packages/api-client` es el cliente HTTP que antes tenía solo la PWA, ahora compartido por las dos apps.

## Pruebas (última corrida)

| Paquete | Resultado |
|---|---|
| Backend (Docker, como `rc_app`) | 155 ✅ |
| `packages/domain` | 16 ✅ |
| `packages/ui` | 74 ✅ |
| `apps/driver` | 66 ✅, y 10/10 contra el Django real |
| `apps/admin` | 17 ✅, y 5/5 contra el Django real |
| Chequeo de tipos y compilación de las dos apps | ✅ |

## Decisiones que tomé (para revisar)

1. **Ramas en cadena** (backend → driver → diseno → admin), en lugar de una rama por parte desde `main`. Cada parte depende de la anterior.
2. **Recorrido del mapa en violeta.** El azul se confunde con el agua en el mapa. Los huecos van en naranja oscuro punteado, y el inicio y el fin en verde y rojo.
3. **"Sin señal" = más de 10 minutos sin puntos** en una jornada en curso (`NO_SIGNAL_MINUTES` en `packages/domain`). Es un umbral de interfaz; el umbral de hueco del backend sigue siendo de 5 min y se configura por empresa.
4. **Reintento automático solo en lecturas, y una sola vez.** Las escrituras ya tienen su cola con espera creciente.
5. **CSS propio con tokens**, sin Tailwind ni una biblioteca de componentes (ADR-007). Se puede revisar en la etapa 1.
6. **Ruteo del panel por `#hash`**, sin TanStack Router: alcanza para tres pantallas. El plan propone TanStack Router para la etapa 1.
7. **El "hoy" del dashboard es la fecha del navegador.** El backend filtra por la fecha de la jornada en la zona horaria de la empresa; si las dos zonas difieren, cerca de la medianoche puede no coincidir.
8. **El panel no es PWA instalable todavía** (§1 lo menciona para escritorio): no lo pedía la etapa 0.
9. **Textos de UI nuevos** (aviso de privacidad, estados vacíos y explicaciones de los huecos): el aviso de privacidad sigue siendo provisorio y necesita revisión legal (§11).

## Lo que no pude hacer

- **No vi las pantallas en un navegador.** En esta sesión no tengo uno. Verifiqué todo con pruebas automáticas (jsdom), compilación y llamadas reales a la API, pero **el aspecto visual hay que revisarlo a ojo**, sobre todo en el iPhone.
- **No abrí un túnel para el panel:** el sistema de permisos lo bloqueó. Abajo está el comando para abrirlo vos si querés verlo en el celular.

## Pendiente

Además de lo que ya estaba en [pendientes-etapa-1.md](pendientes-etapa-1.md):

- Revisar visualmente las dos apps en Android, iPhone y escritorio.
- Completar la prueba en teléfonos ([etapa0-prueba-en-telefonos.md](etapa0-prueba-en-telefonos.md)) y el informe de la etapa 0.
- Panel: TanStack Router, PWA de escritorio y mapa en vivo (etapa 1).
- La jornada del dashboard según la zona horaria de la empresa.

## Cómo verlo

### En la computadora

Desde `C:\dev\routcontrol`, con Docker Desktop abierto:

```bash
pnpm backend:dev          # terminal 1: base de datos y backend
pnpm backend:seed         # una vez: usuarios de demo
pnpm driver:dev           # terminal 2: PWA en http://localhost:5173
pnpm admin:dev            # terminal 3: panel en http://localhost:5174
```

- **PWA:** `repartidor1@norte.demo` … `repartidor5@norte.demo`.
- **Panel:** `duenio@norte.demo`.
- **Contraseña de todos:** `routcontrol-demo`.

### En el celular

- **PWA:** el túnel que dejé abierto sirve la versión nueva: https://spectrum-transit-rangers-paths.trycloudflare.com
  - En un teléfono donde ya estaba instalada: cerrala y abrila de nuevo, y aceptá "Hay una versión nueva".
  - Si el túnel se cortó, seguí [etapa0-prueba-en-telefonos.md](etapa0-prueba-en-telefonos.md) para levantarlo otra vez (la dirección cambia).
- **Panel:** con `pnpm admin:dev` corriendo, en otra terminal ejecutá `cloudflared tunnel --url http://localhost:5174` y abrí en el celular la dirección que muestra. En pantallas angostas la barra lateral pasa arriba.
