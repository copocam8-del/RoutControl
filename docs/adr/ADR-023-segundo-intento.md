# ADR-023: Segundo intento con sugerencia de desvío

- **Estado:** aceptado
- **Fecha:** 02/11/2026
- **Contexto:** etapa 2 de la planificación: "segundo intento" (`SecondAttemptRequest`, §7.2: `requested_window`, `distance_m`, `detour_s`, `pending_count`, `suggestion`, `decision`, `decided_by`). Cuando un paquete no se entregó (por ejemplo, el destinatario llama y dice que está de 14 a 18), alguien del panel decide si el repartidor vuelve hoy y cuándo. No hay maqueta propia.

## Decisión
- **Quién lo pide:** el personal del panel, desde la ficha del paquete no entregado (`FAILED` o `RESCHEDULED`). Puede indicar la franja en la que está el destinatario y una nota para el repartidor. Hay un solo pedido pendiente por paquete.
- **La sugerencia** se calcula al pedirlo (`backend/apps/packages/second_attempt.py`), con la jornada en curso del repartidor asignado:
  - **inserción más barata:** entre cada par de puntos consecutivos de lo que le queda (su última ubicación y las paradas pendientes en el orden de la ruta), el lugar donde sumar el domicilio agrega menos camino. También se mide ponerlo al final;
  - **estimación en línea recta** × 1,3 a 20 km/h. Es deliberadamente simple: no depende de que OSRM esté prendido (en el servidor es opcional) y alcanza para decidir entre "ahora", "al final" o "mañana". El panel aclara que es una estimación;
  - **reglas:**

    | Situación | Sugerencia |
    |---|---|
    | Desvío de 10 min o menos | **Insertarlo** después de la parada N |
    | Al final de la ruta, 25 min o menos | **Al final de la ruta** |
    | Desvío mayor, o el repartidor no está en jornada | **Mañana** |
    | El domicilio no tiene ubicación | Al final, avisando que no se pudo medir |
  - todo configurable por empresa en `settings["second_attempt"]` (`insert_max_min`, `end_max_min`, `speed_kmh`, `road_factor`).
- **La decisión es de una persona:** se acepta la sugerencia, se elige otra opción o se descarta. Queda registrado quién y cuándo.
  - **Insertar** o **al final:** el paquete vuelve a "asignado" y entra en la ruta de la jornada en ese lugar. El resto del orden no cambia y conserva los tramos por calles.
  - **Mañana:** queda reprogramado.
  - **Descartar:** no cambia nada.
- **El repartidor lo ve como segundo intento:** el paquete trae `second_attempt` (franja y nota).
  - En la ficha aparece "Segundo intento · El destinatario está de 14:00 a 18:00 · nota".
  - En el mapa se pinta en violeta claro, el color de "segundo intento" (ADR-019), aunque el estado vuelva a "asignado".
  - La visita que haga se marca como segundo intento, como ya pasaba.
- **API** (solo personal, con pruebas de aislamiento entre empresas):
  - `POST /packages/{id}/second-attempt`;
  - `GET /second-attempts?package=&decision=`;
  - `POST /second-attempts/{id}/decide {accept, placement?}`.
- **Avisarle al repartidor:** recibe el cambio al actualizar su lista. El aviso en el momento llega con las alertas (ADR-025).

## Verificado
- **backend:**
  - la inserción más barata;
  - sin jornada, sugiere mañana;
  - solo se pide para paquetes no entregados y no se duplica;
  - cerca de la ruta: insertar después de la parada 1 y, al aceptar, la ruta queda A → X → B y el paquete trae la franja y la nota;
  - lejos: mañana, y al aceptarlo queda reprogramado;
  - se puede elegir "al final" en lugar de la sugerencia;
  - descartar no cambia nada;
  - el repartidor recibe 403;
  - aislamiento entre empresas.

  Las distancias de prueba son puntos sobre una avenida de CABA.
- **domain:** un segundo intento aceptado se ve como segundo intento en el mapa.
- **panel:** pedir con franja y nota, la sugerencia, aceptar, descartar, y que un paquete entregado no lo ofrece.
- **app:** la ficha con la franja y la nota.

## Pendiente
- Usar OSRM para el desvío cuando esté prendido: daría tiempos reales por calle.
- Un listado de pedidos pendientes en "Entregas" (hoy se ven en la ficha de cada paquete).
