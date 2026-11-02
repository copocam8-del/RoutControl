# ADR-017: Mapa en vivo del panel por WebSocket

- **Estado:** aceptado
- **Fecha:** 02/11/2026
- **Contexto:** el inicio del panel ("Dónde están ahora") se actualizaba consultando cada 30 s. La planificación pide ver en vivo dónde está cada repartidor.

## Decisión
- **Django Channels** (`channels`, `channels-redis`) con **Redis** como bus entre el proceso que recibe los puntos y los WebSocket abiertos. Ya usamos Redis para Celery (ADR-010): no se suma infraestructura.
- **Servidor:**
  - `daphne` va primero en `INSTALLED_APPS`, así `runserver` sirve también WebSocket en desarrollo;
  - `config/asgi.py` atiende HTTP con Django y `ws/live` con `LiveConsumer`.
- **Autenticación (`/ws/live`):**
  - el primer mensaje tiene que ser `{"type":"auth","access":"<JWT>"}`. **El token no va en la URL**, que queda en los logs del proxy;
  - solo el personal (dueño, admin, supervisor) con membresía, empresa y usuario activos, validados con RLS dentro del contexto de la empresa del token;
  - si no corresponde, el servidor responde `{"type":"error"}` y cierra con 4403. Si el primer mensaje no es `auth`, o no llega en 10 s, cierra con 4401;
  - **cada 60 s** se vuelve a validar el token y la membresía de cada conexión abierta. A quien se le quitó el acceso, o se le venció el token, se lo desconecta con 4403, y el panel reconecta con un token renovado.
- **Aislamiento:**
  - cada conexión entra **solo** al grupo `live.<organization_id>` de su token;
  - el que publica usa la empresa de la jornada. No hay forma de pedir el grupo de otra empresa.
- **Qué se publica:**
  - al aceptar un lote en `/tracking/batch`, **después del commit** (`transaction.on_commit`), se publica la ubicación más reciente (por hora del teléfono) de los puntos **nuevos** de ese lote: `driver_id` (DriverProfile, igual que en `/drivers`), `workday_id`, `lat`, `lng` y `recorded_at`;
  - un reenvío del mismo lote (todos duplicados) no publica nada;
  - si Redis no está, se registra una advertencia y la ingesta sigue: **el mapa en vivo nunca hace fallar el GPS**.
- **Panel:**
  - `connectLive` abre el WebSocket con el access token en memoria (`ApiClient.accessTokenForSocket`). Si se corta, reintenta con espera creciente (1 s, 2 s, 4 s… hasta 30 s). Si el servidor rechaza el token, lo renueva con la cookie antes de reintentar;
  - en el inicio, la posición en vivo reemplaza la consultada si es de la misma jornada activa y más nueva. Eso actualiza el mapa, la fila del repartidor y el indicador "Sin señal";
  - la consulta cada 30 s sigue: trae las jornadas nuevas y cubre los cortes del WebSocket;
  - el chip "Actualizado hh:mm" pasa a "**En vivo**", con un punto verde, mientras hay conexión. Las maquetas no tienen un indicador propio, así que se reutiliza el mismo chip, en oscuro y en claro con los tokens del tema. Con "reducir movimiento", el punto no late.
  - en desarrollo, Vite manda `/ws` por proxy a Django (`ws: true`). En producción el origen es `API_URL`.

## Verificado
- **Pruebas:**
  - autorización: personal sí; repartidor, membresía desactivada, token de otra empresa y basura, no;
  - consumidor: aislamiento entre empresas (B no recibe lo de A), token rechazado, vencimiento sin `auth` y desconexión al perder el acceso;
  - publicación desde el lote, solo a la empresa de la jornada y sin reenvíos;
  - Redis caído no rompe la ingesta;
  - del lado del panel, el cliente y el inicio.
- **Prueba real**, con Redis y `runserver` (daphne) levantados y apagados después:
  - el dueño de Norte recibió la ubicación que mandó un repartidor de Norte;
  - el dueño de Sur no recibió nada;
  - un repartidor que intentó suscribirse recibió el cierre 4403.

## Pendiente
- **Producción:** servir con un servidor ASGI (daphne o uvicorn) detrás de un proxy que deje pasar WebSocket. Hoy la imagen corre `runserver`, que es solo para desarrollo.
- Una jornada que empieza aparece con la próxima consulta (hasta 30 s), no al instante.
- Quitarle el acceso a alguien tarda hasta 60 s en cortarle el mapa en vivo.
