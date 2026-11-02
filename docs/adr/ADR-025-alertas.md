# ADR-025: Alertas configurables en el panel

- **Estado:** aceptado
- **Fecha:** 02/11/2026
- **Contexto:** etapa 2 de la planificación: "alertas configurables" (modelo `Notification`, rutas `/notificaciones` y `/configuracion/notificaciones` de §9.1). El pedido nombra cinco alertas: inicio y fin de jornada, sin señal, incidencias y recorrido finalizado. No hay maqueta propia.

## Decisión
- **Qué se avisa** (`backend/apps/alerts`):

  | Alerta | Cuándo |
  |---|---|
  | **Inicio de jornada** | El repartidor inicia la jornada. |
  | **Fin de jornada** | La finaliza el repartidor o **se cierra sola** por la duración máxima (ADR-010), y en ese caso lo dice. |
  | **Sin señal** | Una tarea de Celery revisa cada 2 minutos las jornadas en curso y avisa si pasaron más minutos que el umbral de la empresa (15 por defecto) desde la última ubicación. Avisa **una vez por silencio**: si vuelve la señal y se corta de nuevo, avisa otra vez. |
  | **Incidencia** | Una visita no entregada (ADR-016), con el motivo y el paquete. |
  | **Recorrido finalizado** | Al repartidor no le quedan paradas pendientes en la jornada; va con cuántos entregó y cuántos no. |
- **Para quién:** todo el personal de la empresa (dueño, admin, supervisor). Los repartidores no las ven.
  - Cada persona tiene su **"visto hasta"**: lo posterior cuenta como nuevo, y abrir "Alertas" marca todo como visto para esa persona.
  - Es más simple que una fila por destinatario y alcanza para "nuevas / vistas".
- **Configurables por empresa:** cada alerta se prende o se apaga, y "sin señal" tiene su umbral. Se configura en **Configuración**, que también reúne los umbrales del **indicador de domicilios** (ADR-022) y del **segundo intento** (ADR-023).
  - Pueden cambiarla el dueño y el admin. El supervisor la ve sin poder editarla.
  - Se validan los rangos y la coherencia: el umbral amarillo tiene que ser menor que el verde, y "al final" tiene que admitir al menos el desvío de "insertar".
- **Sin duplicados:** cada alerta tiene una clave única por empresa (por ejemplo, `no_signal:<jornada>:<última ubicación>`).
- **Nunca rompe la operación:** si emitir una alerta falla, se registra y lo que la disparó (iniciar la jornada, registrar una visita) sigue igual.
- **En vivo:** al guardarse (después del commit), la alerta viaja por el WebSocket del mapa en vivo (ADR-017) como `{type: "notification", notification}`. La alerta va **adentro** del evento para que su propio `type` (`INCIDENT`, …) no pise el del evento; las pruebas encontraron ese error y quedó corregido.
- **Panel:**
  - **"Alertas"** en la barra lateral, con el contador de nuevas. Se actualiza cada 30 s y, con el inicio abierto, al instante por la conexión que ya existe (no se abre otra).
  - Cuando llega una en vivo, aparece un **aviso flotante** unos segundos. Lleva a Alertas y respeta "reducir movimiento".
  - **La pantalla de alertas** muestra las últimas 50, con su tipo, cuándo llegaron y un enlace a la jornada o al paquete. Las nuevas se resaltan.
  - **Configuración** tiene tres grupos (alertas, indicador de domicilios y segundo intento), con las mismas tarjetas y campos del panel, en oscuro y en claro.
- **API:**
  - `GET /notifications`;
  - `POST /notifications/seen`;
  - `GET/PUT /settings`.

  Todas tienen prueba de aislamiento entre empresas. La función `rc_active_workdays()` (SECURITY DEFINER) lista las jornadas en curso de todas las empresas para la tarea periódica, y la revisión se hace dentro del contexto de cada una, con RLS. Es el mismo patrón que el cierre automático.

## Verificado
- **backend:**
  - inicio y fin de jornada;
  - el "visto" por persona;
  - el repartidor recibe 403;
  - incidencia y recorrido finalizado (incluidas las visitas que llegan sin jornada, como en apps viejas);
  - apagar una alerta;
  - la validación y los permisos de la configuración, y su efecto en los umbrales del indicador y del segundo intento;
  - "sin señal" una sola vez por silencio y con el umbral de la empresa;
  - el envío en vivo después del commit;
  - el cierre automático;
  - aislamiento entre empresas.
- **panel:**
  - el contador;
  - abrir Alertas las marca vistas;
  - los enlaces a la jornada o al paquete;
  - en vivo por el WebSocket, el aviso flotante y el contador;
  - guardar la configuración;
  - el supervisor la ve sin poder editarla.
- **WebKit, en oscuro y en claro:** Configuración, y Alertas con dos alertas reales (inicio y fin de una jornada corta de `repartidor5@norte.demo` en la base de desarrollo).

## Pendiente
- Avisos fuera del panel: push al celular del supervisor, o email (falta el proveedor de correo, ADR-021).
- Que cada persona elija qué alertas recibe (hoy es por empresa).
- Alertas para el repartidor (por ejemplo, "te sumaron un segundo intento").
