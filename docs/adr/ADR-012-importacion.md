# ADR-012: Importación genérica de paquetes (CSV y Excel)

- **Estado:** aceptado
- **Fecha:** 02/11/2026
- **Contexto:** todavía no hay un archivo de ejemplo de los clientes (§15.3, pendiente 4). La importación tiene que aceptar formatos distintos sin cambiar código.

## Decisión
- **Flujo en tres pasos, solo para el personal:**
  1. `POST /imports/` (multipart, campo `file`): lee el archivo y sugiere un mapeo de columnas.
  2. `POST /imports/{id}/preview {mapping}`: valida **todas** las filas con el mapeo y no crea nada. Devuelve el resumen, las primeras 50 filas ya mapeadas y los errores por fila y campo.
  3. `POST /imports/{id}/confirm {mapping}`: crea solo las filas válidas (origen `IMPORT`, con `import_job_id`). Es idempotente: confirmar dos veces no importa dos veces.
- **Formatos:**
  - **CSV** con separador `,`, `;`, tabulación o `|` (se detecta solo), en UTF-8 (con o sin BOM), Windows-1252 o Latin-1;
  - **Excel `.xlsx`**, la primera hoja. Los códigos numéricos de Excel (`1001.0`) se leen como `1001`;
  - los `.xls` viejos se rechazan con un mensaje claro.
  - **Límites:** 5 MB y 5000 filas.
- **Mapeo:** campo de RouteControl → columna del archivo.
  - La sugerencia compara nombres normalizados (sin acentos ni signos) contra sinónimos en español e inglés: "Nro de guía", "Tracking number", "Domicilio", "Altura", "CP" y otros.
  - El usuario la corrige en el panel.
  - Obligatorios: el código y la dirección, completa o al menos la calle.
- **Campos:**
  - código;
  - destinatario y teléfono;
  - dirección completa, o calle, altura, piso o depto, localidad, provincia y CP;
  - observaciones;
  - latitud y longitud, que van juntas y aceptan coma decimal;
  - **repartidor por email:** si el email es de un repartidor activo de la empresa, el paquete queda asignado.
- **Errores por fila** (número de fila del archivo; el encabezado es la 1):
  - falta el código o es demasiado largo;
  - **ya existe en la empresa**;
  - **está repetido en el archivo** (indica la otra fila);
  - falta la dirección;
  - coordenadas inválidas o incompletas;
  - el repartidor no existe.
- **Minimización (§11):** las filas del archivo se guardan en `ImportJob.rows` solo hasta confirmar. Después se borran y quedan los totales, el mapeo y los errores. El archivo en sí no se guarda todavía: `file_key` queda para cuando haya almacenamiento (S3/R2).

## Pendiente
- Plantillas de mapeo guardadas por empresa, para no mapear cada vez. Hace falta ver archivos reales primero.
- Geocodificación de las direcciones importadas (Georef).
- Importaciones de más de 5000 filas: en segundo plano con Celery.
