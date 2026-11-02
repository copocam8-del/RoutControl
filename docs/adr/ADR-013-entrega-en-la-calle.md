# ADR-013: La entrega en la calle (Mis paquetes, ficha, visita, fotos)

- **Estado:** aceptado
- **Fecha:** 02/11/2026

## Backend
- **`POST /visits`** (repartidor): registra la visita con su resultado. Es idempotente por el `id` que genera el teléfono.
  - **Resultados (§7.2):** Entregado, o No entregado con motivo: destinatario ausente, nadie responde, pide reprogramar, dirección incorrecta, no se puede acceder u otro inconveniente.
  - **Atribución:** sale de la tabla de §7.2. En "Otro inconveniente" la elige el repartidor, y las observaciones son obligatorias.
  - **Estado del paquete:** Entregado → `DELIVERED`; pide reprogramar → `RESCHEDULED`; el resto → `FAILED`. Si el paquete no se cargó con el escaneo, pasa antes por `IN_ROUTE`. Cada cambio deja su evento.
  - Una visita después de una falla queda marcada `is_second_attempt`. Un paquete entregado ya no admite visitas (409).
- **`POST /evidence`** (multipart): la foto de la visita, JPG, PNG o WEBP de hasta 8 MB. Es idempotente por `id`.
  - Se guarda con su `sha256`, en `evidencia/<empresa>/<paquete>/<id>.<ext>`.
  - **Almacenamiento:** en desarrollo, el disco (`backend/media`, fuera de git); en producción, un almacenamiento de objetos (S3 o R2) configurado en el despliegue. Ese punto queda pendiente.
  - **Nunca se sirve directo:** `GET /evidence/{id}/file` la devuelve solo a quien puede ver el paquete.
  - Si la foto llega antes que su visita, responde 409 `visit_not_found` y el teléfono reintenta.
- **`POST /communications`:** registra cada "Llamar" y "WhatsApp" tocado, para el historial del paquete.
- **`GET /packages/{id}/visits`:** las visitas con sus fotos, para el panel y para el propio repartidor.
- **Aislamiento:** cada endpoint tiene su prueba entre empresas, y un repartidor no puede tocar paquetes de un compañero.

## PWA
- **Pestaña "Paquetes"** en la barra inferior, como la maqueta: Inicio, Paquetes, Recorridos y Perfil.
- **Mis paquetes:**
  - filtros Pendientes, Entregados y No entregados, con su cantidad, y búsqueda;
  - la lista se guarda en el teléfono y se ve sin conexión, con un aviso.
- **Ficha de entrega:**
  - destino, destinatario y observaciones;
  - **Llamar** (`tel:`) y **WhatsApp** (`wa.me`, con el número llevado al formato internacional argentino: se quitan el 0 y el 15, y se agrega 549). Sin teléfono no aparecen;
  - **Navegar** abre Google Maps o Waze con enlaces, sin API de Google: por coordenadas si las hay y, si no, por la dirección.
- **Visita:**
  - "Llegué: iniciar visita" **exige la jornada iniciada**, porque el GPS corre solo durante la jornada;
  - el cronómetro sale de la hora de inicio guardada en el teléfono, así que sigue aunque se cierre la app;
  - el resultado se elige con botones grandes y, si no se entregó, se elige el motivo;
  - foto opcional, achicada en el teléfono a 1600 px en JPEG antes de guardarla;
  - una sola visita en curso a la vez.
- **Offline primero:** la visita, la foto y las comunicaciones van a una cola en IndexedDB (`outbox`) y se envían en orden, con la foto después de su visita.
  - Sin red o con un error del servidor, se reintenta con espera creciente.
  - Un rechazo que reintentar no arregla (400, 403, 404, 409) queda marcado y se avisa, sin frenar lo demás.
  - El estado del paquete cambia en el teléfono enseguida.
- **Jornada en curso** (Jornada.dc.html): avance "N de M entregados", cifras de Entregados, Pendientes y No entregados, y la **próxima parada** con Llamar, WhatsApp, Navegar y "Llegué: iniciar visita".
  - Por ahora la próxima es el primer pendiente; el orden de la ruta llega con "Armar mi ruta".

## Pendiente
- Almacenamiento de fotos en producción (S3 o R2) y su retención (§11).
- Firma o aclaración de quien recibe, si el cliente la pide.
- Ver en la PWA el historial de visitas del paquete.
