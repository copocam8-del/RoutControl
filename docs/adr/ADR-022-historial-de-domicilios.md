# ADR-022: Historial de domicilios e indicador de recepción

- **Estado:** aceptado
- **Fecha:** 02/11/2026
- **Contexto:** etapa 2 de la planificación: "historial e indicador de domicilios" (§7.3 y la ruta `/domicilios/:id` de §9.1). No hay maqueta propia; la de Jornada.dc.html ya mostraba el chip "Suele recibir" en la próxima parada.

## Decisión
- **Cálculo** (`backend/apps/packages/reception.py`), tal como lo define §7.3:
  - **cuentan** las entregas y las fallas atribuibles al destinatario (ausente, nadie responde, pidió reprogramar). Las de logística (dirección incorrecta, acceso imposible) no cuentan, porque no dicen si el domicilio "suele recibir". Las visitas anuladas tampoco;
  - **peso por antigüedad** `0,5 ^ (días / 30)`;
  - "**Cliente solicita reprogramación**" pesa la mitad que una ausencia (§7.2: "peso menor");
  - **niveles:**

    | Nivel | Texto | Condición |
    |---|---|---|
    | Gris | "Sin historial" | menos de 3 visitas que cuenten |
    | Verde | "Suele recibir" | 80 % o más |
    | Amarillo | "A veces no está" | de 40 % a 80 % |
    | Rojo | "Suele no estar" | menos de 40 % |
  - **configurable por empresa** en `organization.settings["reception"]` (`green`, `yellow`, `min_visits`, `half_life_days`, `reschedule_weight`). La pantalla para cambiarlos llega con la configuración de alertas (ADR-025).
  - **Informativo:** nunca descarta ni bloquea una entrega.
- **Se calcula al leer, no se guarda.** Así siempre refleja las últimas visitas y el peso por antigüedad del día. En una lista de paquetes se resuelve con **una sola consulta** para todos los domicilios (`for_addresses`). El campo `Address.reception_stats` queda para guardarlo si el volumen lo pide.
- **Dónde se ve:**
  - **en cada paquete** (`reception: {level, score, computable}`), para la app y el panel. En la app es opcional, porque los paquetes guardados en el teléfono antes de este cambio no lo traen;
  - **en la app:** el chip va en la ficha, debajo del destinatario, y en la "Próxima parada" del inicio, en el lugar de la maqueta;
  - **en el panel:**
    - la ficha del paquete muestra el chip y el enlace "Ver historial del domicilio";
    - `#/domicilios/<id>` muestra el indicador (porcentaje, visitas que cuentan, entregadas, ausencias), una explicación en llano de cómo se calcula, todas las visitas (fecha, paquete, repartidor, resultado, atribución, duración y fotos) y los paquetes del domicilio.
- **API:** `GET /addresses/{id}` es solo para el personal y tiene su prueba de aislamiento entre empresas. El repartidor no ve el historial completo: ve solo el chip.
- **Componente compartido:** `ReceptionBadge` (`@routcontrol/ui`), con un punto, el texto y el detalle en el título, en los tonos del tema (oscuro y claro).

## Verificado
- **backend:**
  - niveles y umbrales;
  - que la logística no cuente;
  - el peso por antigüedad (caso calculado a mano);
  - la reprogramación pesa la mitad;
  - la configuración por empresa;
  - el indicador en el listado y en el detalle;
  - el historial;
  - el repartidor recibe 403;
  - el aislamiento entre empresas.
- **ui:** el chip.
- **panel:** de la ficha al historial.
- **app:** la ficha (con y sin el dato) y la próxima parada.

## Pendiente
- La revisión visual del historial en un navegador, con datos reales de visitas. Los datos de demo todavía no tienen visitas.
- Corregir la ubicación de un domicilio desde el historial (`location_corrected_by`).
