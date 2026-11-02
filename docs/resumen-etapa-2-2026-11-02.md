# Resumen: cierre del mapa, despliegue y etapa 2 — 02/11/2026

Pedido: terminar las paradas del mapa, dejar preparado el despliegue para un servidor Linux genérico, y la etapa 2 (domicilios, segundo intento, informes y alertas). Una rama y un PR por parte, **sin fusionar**.

## Pull requests

| # | Parte | Rama | Base | ADR | CI |
|---|---|---|---|---|---|
| [#16](https://github.com/copocam8-del/RoutControl/pull/16) | Paradas superpuestas y "Próxima" en la leyenda (cierre del mapa) | `etapa-2/paradas-superpuestas` | `main` | 020 | ✅ |
| [#17](https://github.com/copocam8-del/RoutControl/pull/17) | Despliegue en un servidor Linux con un solo comando | `etapa-2/despliegue` | `main` | 021 | ✅ |
| [#18](https://github.com/copocam8-del/RoutControl/pull/18) | Historial de domicilios e indicador verde, amarillo, rojo y gris | `etapa-2/domicilios` | `main` | 022 | ✅ |
| [#19](https://github.com/copocam8-del/RoutControl/pull/19) | Segundo intento con sugerencia de desvío | `etapa-2/segundo-intento` | #18 | 023 | ✅ |
| [#20](https://github.com/copocam8-del/RoutControl/pull/20) | Informes por repartidor y por empresa, con exportación | `etapa-2/informes` | #19 | 024 | ✅ |
| [#21](https://github.com/copocam8-del/RoutControl/pull/21) | Alertas configurables en el panel | `etapa-2/alertas` | #20 | 025 | ver el PR |

- **#16 y #17** son independientes: se fusionan cuando quieras.
- **De #18 a #21** están apilados (ADR-009): se fusionan en orden y, al fusionar uno, el siguiente se cambia de base a `main`.
- **Este resumen** va en la rama de #21.

## Qué quedó hecho

**Mapa (#16)**
- Las paradas que en pantalla quedan una encima de otra se abren en círculo y se pueden tocar todas. Se recalcula con el zoom.
- La leyenda suma "Próxima".

**Despliegue (#17)** — `docs/despliegue.md`
- **Un solo comando:** `sudo DOMAIN=… EMAIL=… ./infra/prod/install.sh`. Instala Docker si falta, genera las contraseñas y levanta todo. Funciona en x86 y ARM.
- **HTTPS automático** con Caddy para `app.`, `panel.` y `api.`.
- **Copias diarias** de la base y de las fotos, con su restauración. `update.sh` hace una copia, actualiza y reinicia.
- **Alta de empresas:** el comando `create_company`.
- **Probado completo en esta compu:** login, cookie de sesión, WebSocket, mapa, una copia **y su restauración**. Sin el ruteo usa unos 450 MB.

**Domicilios (#18)**
- **El indicador** se calcula según la planificación (§7.3):
  - solo cuentan las entregas y las fallas del destinatario;
  - las visitas recientes pesan más;
  - los umbrales son configurables.
- **En la app:** el chip "Suele recibir" en la ficha y en la próxima parada.
- **En el panel:** el historial completo del domicilio (`#/domicilios/<id>`).

**Segundo intento (#19)**
- Desde la ficha del paquete no entregado se pide indicando la franja del destinatario. El servidor sugiere una de tres opciones: insertarlo en la ruta de hoy, ponerlo al final o dejarlo para mañana, según el desvío.
- El panel acepta, elige otra opción o descarta.
- El repartidor lo ve como "Segundo intento", con la franja y la nota.

**Informes (#20)**
- **Períodos:** día, semana, quincena, mes y rango.
- **Por repartidor y total de la empresa:** jornadas, horas, km (solo por tramos con señal), visitas, entregados, no entregados (del destinatario y de logística), tasa de entrega, minutos por visita y segundos intentos.
- **Exportación** a Excel y CSV.
- El repartidor solo ve el suyo.

**Alertas (#21)**
- **Qué se avisa:** inicio y fin de jornada, sin señal (con umbral), incidencias y recorrido finalizado.
- **En el panel:** contador, aviso en vivo y pantalla de alertas.
- **Configuración:** las alertas y los umbrales del indicador y del segundo intento.

## Pruebas

| Parte | Resultado |
|---|---|
| backend | 293 pasadas, 1 omitida (la de OSRM/VROOM reales) |
| domain | 42 |
| ui | 258 |
| admin | 52 |
| driver | 163 |

- Typecheck y migraciones al día en todas las ramas.
- Cada endpoint nuevo tiene su prueba de aislamiento entre empresas.
- Las pantallas nuevas del panel se revisaron en WebKit (el motor de Safari), en oscuro y en claro, con datos reales de la base de desarrollo.

**Errores que encontraron las pruebas y quedaron corregidos:**
- en el WebSocket, el tipo de la alerta pisaba el tipo del evento;
- `?format=` de la exportación chocaba con un parámetro reservado de DRF; ahora se llama `?formato=`;
- en el restore, la tabla de PostGIS daba errores. Ahora restaura sin errores, con `--exit-on-error`.

## Lo que hay que saber
- **Datos de la base de desarrollo:**
  - para ver alertas reales hice un inicio y fin de jornada corto de `repartidor5@norte.demo`;
  - antes, el informe ya mostraba las jornadas de prueba de la etapa 0 (46 jornadas de un minuto del repartidor 2).
- **Memoria:**
  - apagué las previews y los túneles del último pedido;
  - OSRM y VROOM siguen apagados;
  - durante el trabajo levanté el backend y el panel solo para cada revisión visual y los apagué al terminar;
  - queda prendida solo la base de Docker.
- **Una prueba de la app del repartidor falla de vez en cuando** en la corrida completa con la compu cargada. Pasó en 1 de cada 4 corridas aproximadamente, y nunca al repetirla. No pude ver cuál es; el CI la va a nombrar si vuelve a fallar.

## Pendiente y por qué

**Necesita un servidor o un proveedor**
- Probar el despliegue en un servidor real con dominio, y en ARM.
- Copia de seguridad fuera del servidor: falta elegir el destino (S3, R2, Drive).
- Correo transaccional (alertas por email, recuperación de contraseña): falta el proveedor.
- Monitoreo del servidor.

**Mejoras anotadas en los ADR**
- Segundo intento: usar OSRM para el desvío cuando esté prendido, y un listado de pedidos pendientes en Entregas.
- Informes: un gráfico de la evolución diaria, e informes del repartidor en la app.
- Alertas: avisos push o por email, preferencias por persona, y alertas para el repartidor.
- Domicilios: corregir la ubicación desde el historial.

**Otras maquetas**
- Las demás maquetas nuevas (Paquetes, Escanear, Ficha con resultado, Visita, Resultado) quedan para un PR aparte, pantalla por pantalla.

**Resto de la etapa 2** (no estaba en este pedido)
- Registro autogestionado de empresas (hoy se usa `create_company`), límites por plan, y exportación y baja de empresa.
