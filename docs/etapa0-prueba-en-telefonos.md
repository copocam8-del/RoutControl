# Etapa 0: prueba de la PWA en teléfonos reales

Objetivo (§14, punto 5): comprobar en teléfonos reales que la PWA se instala, registra la ubicación con la app abierta, guarda todo sin señal y lo envía cuando vuelve, sin duplicados y con la hora original.

> Los datos son **de demostración**. La PWA no registra ubicación con la pantalla bloqueada ni con la app cerrada (§4.2): esos tramos tienen que aparecer como **huecos**. Eso es lo esperado, no un error.

## 1. Levantar todo en la computadora

Desde `C:\dev\routcontrol`, con Docker Desktop abierto, en tres terminales:

```bash
# Terminal 1: base de datos y backend
pnpm backend:dev
pnpm backend:seed              # una sola vez: crea los usuarios de demo

# Terminal 2: la PWA compilada (con Service Worker), en http://localhost:4173
pnpm driver:build
pnpm driver:preview

# Terminal 3: túnel HTTPS (el teléfono necesita HTTPS para la ubicación y para instalar la app)
cloudflared tunnel --url http://localhost:4173
```

`cloudflared` muestra una dirección `https://<algo>.trycloudflare.com`. **Esa es la dirección que se abre en los teléfonos.**

- La dirección **cambia cada vez** que se vuelve a correr `cloudflared`. Si cambia, hay que borrar la app instalada en el teléfono y volver a instalarla con la dirección nueva.
- Funciona mientras la computadora esté prendida y las tres terminales abiertas.
- Para instalar `cloudflared`: `winget install Cloudflare.cloudflared`.

## 2. Un usuario por teléfono

Hay una sola jornada activa por repartidor, así que **cada teléfono usa un usuario distinto**. La contraseña de todos es `routcontrol-demo`.

| Teléfono | Usuario |
|---|---|
| Android 1 | `repartidor1@norte.demo` |
| Android 2 | `repartidor2@norte.demo` |
| Android 3 | `repartidor3@norte.demo` |
| iPhone 15 | `repartidor4@norte.demo` |
| iPhone 13 | `repartidor5@norte.demo` |

## 3. Instalar la app

### Android (Chrome)

1. Abrí **Chrome** y entrá a la dirección del túnel.
2. Tocá **"Instalar la app en el teléfono"** en la pantalla de inicio de la app. Si no aparece: menú **⋮ → Instalar app** (o **Agregar a la pantalla principal**).
3. Abrí la app desde el ícono nuevo de la pantalla principal (no desde Chrome).
4. Revisá que la **Ubicación** del teléfono esté activada (panel de notificaciones).

### iPhone (Safari)

1. Abrí **Safari** (no Chrome) y entrá a la dirección del túnel.
2. Tocá **Compartir** (el cuadrado con la flecha) → **Agregar a inicio** → **Agregar**.
3. Abrí la app desde el ícono nuevo de la pantalla de inicio (no desde Safari).
4. Revisá en **Ajustes → Privacidad y seguridad → Localización** que la localización esté activada y que **Sitios web de Safari** no esté en **Nunca** (elegí **Mientras se usa la app**). Si está en **Nunca**, el iPhone rechaza la ubicación sin preguntar.

## 4. Qué probar en cada teléfono (unos 20 minutos, afuera o cerca de una ventana)

1. **Instalación:** la app se abre desde su ícono, a pantalla completa y sin la barra del navegador.
2. **Ingresar** con el usuario de ese teléfono.
3. **Iniciar jornada:** aparece el aviso de privacidad → "Entendido" → el teléfono pide permiso de ubicación → elegí **"Mientras se usa la app"** (Android) o **"Permitir al usar la app"** (iPhone).
   - ✅ Esperado: el cronómetro corre, "Registrando recorrido (con la app abierta)" en verde, "Conectado y actualizado".
   - Si el teléfono **no pregunta** y aparece "La ubicación está bloqueada para esta app", la app muestra los pasos para habilitarla (distintos en iPhone y en Android). La jornada **no** se inicia sin ubicación. Después de habilitarla, tocá "Ya lo habilité, iniciar jornada". Anotalo en Notas.
4. **Caminar 3 minutos con la app abierta.**
   - ✅ Esperado: "Última ubicación hace pocos segundos". En **Diagnóstico**, los "Puntos pendientes de envío" bajan a 0 cada pocos segundos.
5. **Modo avión:** activalo y caminá 3 minutos más con la app abierta.
   - ✅ Esperado: "Sin conexión, cambios guardados", y los "Puntos pendientes" **suben**.
6. **Volver a tener señal:** desactivá el modo avión (con la app abierta).
   - ✅ Esperado: en menos de un minuto, "Sincronizando…" y después "Conectado y actualizado", con los pendientes en 0.
7. **Pantalla bloqueada:** bloqueá el teléfono 5 minutos y volvé a abrir la app.
   - ✅ Esperado: "Recorrido en pausa" mientras estuvo bloqueado, y después vuelve a "Registrando". Ese tramo va a aparecer como hueco.
8. **Finalizar sin señal:** activá el modo avión y tocá **Finalizar jornada**.
   - ✅ Esperado: "Finalizando… (se envía al volver la señal)". Desactivá el modo avión: la pantalla vuelve a "Sin jornada".
9. **Mis recorridos:** abrí la jornada recién terminada.
   - ✅ Esperado: el recorrido en el mapa, los tramos sin datos (pantalla bloqueada) como **línea punteada**, el punto verde de inicio y el rojo de fin, y la distancia.

Si algo falla, sacá una captura de la pantalla **Diagnóstico** (permiso, pendientes, registro): es lo que más sirve para encontrar el problema.

## 5. Resultados (para el informe de la etapa 0)

Completar una fila por teléfono: ✅ funcionó · ❌ no funcionó · ⚠️ funcionó con problemas (anotar cuáles).

| Teléfono / modelo | Sistema y navegador | 1. Instalación | 3. Iniciar | 4. Ubicación | 5. Modo avión | 6. Vuelve la señal | 7. Bloqueo → hueco | 8. Finalizar sin señal | 9. Mapa | Notas |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |
| | | | | | | | | | | |
| | | | | | | | | | | |
| iPhone 15 | iOS … · Safari | | | | | | | | | |
| iPhone 13 | iOS … · Safari | | | | | | | | | |

## Problemas conocidos de la etapa 0

- **Pantalla bloqueada o app cerrada = hueco.** Es una limitación de las PWA (§4); el recorrido continuo llega con la app nativa (fase 2).
- **Si el token de seguimiento queda inválido**, los puntos quedan guardados en el teléfono pero no se envían (pendiente de la etapa 1, ver `docs/pendientes-etapa-1.md`). En Diagnóstico aparece como `token_invalid`.
- **Abrir la app en dos pestañas a la vez** puede cerrar la sesión: la protección contra el robo de sesiones lo toma como reuso del token (ADR-005). Volvé a ingresar.
