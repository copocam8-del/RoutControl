# ADR-016: Panel de paquetes, entregas e incidencias

- **Estado:** aceptado
- **Fecha:** 02/11/2026
- **Contexto:** las maquetas aprobadas cubren el inicio, las jornadas y los repartidores del panel, pero no estas pantallas. Siguen el mismo lenguaje: barra lateral, títulos, tarjetas `panel-card`, chips de filtro y tablas, en oscuro y en claro.

## Decisión
- **Barra lateral:** Inicio, Jornadas, **Paquetes**, **Entregas** y Repartidores.
- **Paquetes** (`#/paquetes`):
  - filtros por estado con su cantidad y búsqueda;
  - **asignación masiva:** se seleccionan paquetes (solo los asignables), se elige el repartidor y se asigna o se desasigna. El resultado se informa por paquete;
  - **"Nuevo paquete":** formulario de alta. Al crear se abre la ficha. Los errores muestran el motivo del servidor, por ejemplo "Ya existe un paquete con el código…".
- **Ficha del paquete** (`#/paquetes/<id>`):
  - datos;
  - asignar y desasignar;
  - **cancelar**, con confirmación;
  - el **historial** de eventos;
  - las **visitas con sus fotos**. Las fotos se bajan con la sesión: no hay URL pública.
- **Importar** (`#/paquetes/importar`): subir el archivo → elegir qué columna es cada dato (con la sugerencia del servidor y las primeras filas a la vista) → revisar los errores por fila → importar las filas válidas.
- **Entregas** (`#/entregas`):
  - pestaña **Entregas del día:** día con flechas, resumen de entregadas y no entregadas, y una tabla con hora, paquete, dirección, repartidor, resultado y cantidad de fotos;
  - pestaña **Incidencias:** abiertas o resueltas, con el motivo, la descripción, las fotos de la visita y "Marcar resuelta" (guarda quién y cuándo).
- **Qué es una incidencia, por ahora:** **una visita "No entregado" abre una incidencia** de ese tipo. El id sale del de la visita, así que reintentar no duplica. Las incidencias que el repartidor reporte por su cuenta (por ejemplo, "paquete dañado") quedan para cuando el cliente defina los tipos.
- **Backend:**
  - `GET /deliveries?date=`: el día en la zona horaria de la empresa;
  - `GET /incidents?status=`;
  - `POST /incidents/{id}/resolve`, que es idempotente.

  Cada endpoint es solo para el personal y tiene su prueba de aislamiento entre empresas.
- **`useLoad` (`packages/ui`):** ya no vuelve a cargar si se le pasa una función de error nueva en cada render. Era un bucle infinito fácil de provocar.

## Pendiente
- La revisión visual de estas pantallas en un navegador, en oscuro y en claro. Esta noche se verificaron con pruebas, no a ojo.
- La paginación de los paquetes: hoy se listan los últimos 500.
- La edición de los datos del paquete desde el panel. El backend ya la tiene (`PATCH`).
