# ADR-024: Informes por repartidor y por empresa

- **Estado:** aceptado
- **Fecha:** 02/11/2026
- **Contexto:** etapa 2 de la planificación: "informes con exportación", en `/informes` (§9.1). Según los permisos (§8), el dueño, el admin y el supervisor ven todos los informes, y el repartidor solo los propios. El pedido incluye día, semana, quincena, mes y rango. No hay maqueta propia: se usan los componentes del panel (chips, navegación por fecha, indicadores, tablas).

## Decisión
- **Períodos**, en la zona horaria de la empresa:

  | Período | Desde | Hasta |
  |---|---|---|
  | Día | ese día | ese día |
  | Semana | lunes | domingo |
  | Quincena | 1 o 16 | 15 o fin de mes |
  | Mes | día 1 | fin de mes |
  | Rango | fecha elegida | fecha elegida (hasta un año) |

  Las flechas mueven el período para atrás y para adelante; en las quincenas saltan de 1–15 a 16–fin de mes.
- **Qué se mide por repartidor** (`backend/apps/packages/reports.py`):
  - **jornadas** y **horas trabajadas**: la jornada en curso cuenta hasta ahora;
  - **km recorridos:** se suman solo dentro de los tramos con señal, sin la recta por un hueco, igual que en el recorrido (ADR-002). Se calculan con una sola consulta para todas las jornadas;
  - **minutos sin señal** (huecos);
  - **visitas, entregados y no entregados**, separando los del destinatario de los de logística;
  - **tasa de entrega:** entregados sobre visitas cerradas;
  - **minutos promedio por visita;**
  - **segundos intentos.**
- **Por empresa:** la suma de todos, con la tasa recalculada. Los repartidores sin actividad en el período no aparecen.
- **Las jornadas de la app web** (seguimiento solo por eventos, §4.2) se cuentan aparte. El informe aclara que sus km son un mínimo, para no compararlas con las de seguimiento continuo.
- **Exportación:** `GET /reports/export?…&formato=xlsx|csv`.
  - El parámetro se llama `formato` y no `format`, porque DRF reserva `?format=` para elegir su propio formato de respuesta.
  - **Excel:** hoja "Por repartidor", con el título del período, el encabezado y el total en negrita, y la tasa con formato de porcentaje.
  - **CSV:** separado por **punto y coma**, con **coma decimal** y BOM UTF-8, así Excel en español lo abre directo con los acentos bien.
  - Desde el panel se descarga con la sesión (no hay URL pública).
- **Permisos:** el personal ve a todos y puede filtrar por repartidor. El repartidor recibe siempre el suyo y, si pide el de otro, la API responde 403. En la app del repartidor no hay pantalla de informes todavía (queda pendiente).
- **Panel:** "Informes" en la barra lateral. Tiene:
  - los chips de período;
  - las flechas o el rango de fechas;
  - el filtro por repartidor;
  - cuatro indicadores: entregados, tasa, km y horas;
  - la tabla por repartidor con la fila del total;
  - los botones **Excel** y **CSV**.

  La URL guarda el período (`#/informes?periodo=mes&fecha=…`), así se puede compartir o volver.

## Verificado
- **backend:**
  - los cinco períodos, incluidos febrero y las dos quincenas;
  - la validación del rango;
  - un día con actividad: 1 km recorrido y, después de un hueco de 40 minutos, un salto de 10 km que **no** se suma;
  - 3 visitas (entregada, del destinatario y de logística), con la tasa y el promedio;
  - el repartidor solo ve el suyo y recibe 403 si pide el de otro;
  - la exportación CSV y Excel (abierta con openpyxl);
  - el aislamiento entre empresas, también en el archivo exportado.
- **domain:** navegación de períodos.
- **panel:** tabla, total, nota de la app web, cambio de período, exportación y rango.
- **WebKit, en oscuro y en claro,** con los datos reales de las pruebas de la etapa 0.

## Pendiente
- Un gráfico de la evolución diaria.
- Los informes del repartidor en la app ("Mis números").
- Informes muy largos (un año con muchos repartidores) en segundo plano con Celery, si llegan a tardar.
