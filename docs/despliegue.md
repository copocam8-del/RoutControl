# Despliegue en un servidor Linux

Una vez contratado el servidor, todo el despliegue se hace con un solo comando. Funciona en **x86 y ARM** (por ejemplo, un VPS común o uno ARM de Hetzner o AWS Graviton). Decisiones: `docs/adr/ADR-021-despliegue.md`.

## Qué se instala

| Servicio | Qué hace | Memoria medida |
|---|---|---|
| `web` (Caddy) | HTTPS automático (Let's Encrypt). Sirve la app del repartidor, el panel y el mapa, y pasa la API y el WebSocket al backend | ~15 MB |
| `backend` (Django + Daphne) | API y mapa en vivo (WebSocket). Migra la base al arrancar | ~95 MB |
| `worker` (Celery) | Tareas periódicas: cierre de jornadas olvidadas y alertas | ~175 MB |
| `db` (PostgreSQL 16 + PostGIS) | La base, con RLS por empresa. No se expone a internet | ~155 MB |
| `redis` | Cola de tareas y mapa en vivo | ~6 MB |
| `backup` | Una copia diaria de la base y de las fotos | ~4 MB |
| `osrm` + `vroom` (opcional) | "Armar mi ruta" con los datos de AMBA | ~500 MB |

Con todo prendido salvo el ruteo, la stack usa unos **450 MB**: un servidor de **2 GB de RAM** sobra. Con el ruteo prendido, conviene tener **4 GB**.

## Antes de instalar
1. **Un servidor Linux** con Ubuntu 22.04 o 24.04, o Debian 12, con acceso por SSH y `sudo`. Si no tiene Docker, el instalador lo instala.
2. **Un dominio** con tres registros DNS (tipo A, o AAAA si es IPv6) apuntando a la IP del servidor:
   - `app.midominio.com`: la app del repartidor;
   - `panel.midominio.com`: el panel;
   - `api.midominio.com`: la API.
3. **Los puertos 80 y 443** abiertos en el firewall del proveedor. El 80 hace falta para emitir el certificado.

## Instalar (un solo comando)
```bash
git clone https://github.com/copocam8-del/RoutControl.git routcontrol && cd routcontrol
sudo DOMAIN=midominio.com EMAIL=yo@midominio.com \
     COMPANY_NAME="Mi Empresa" OWNER_EMAIL=duenio@midominio.com \
     ./infra/prod/install.sh
```

El instalador hace esto:
1. Instala Docker si falta.
2. Genera `infra/prod/.env` con contraseñas aleatorias. **Guardá una copia en un lugar seguro**: tiene las claves de la base.
3. Avisa si algún subdominio todavía no apunta al servidor o si falta el mapa.
4. Construye las imágenes (la primera vez tarda unos minutos) y levanta todo.
5. Espera a que el backend migre la base.
6. Si se pasaron `COMPANY_NAME` y `OWNER_EMAIL`, crea la empresa y su dueño, y muestra **una sola vez** la contraseña inicial.

Al terminar:
- **App:** `https://app.midominio.com`
- **Panel:** `https://panel.midominio.com`

Otras opciones:
- `APP_NAME=...`: el nombre de la marca.
- `ROUTING=1`: levanta también OSRM y VROOM (ver "Armar mi ruta").

El instalador se puede volver a correr: no pisa `.env` ni los datos.

### Más empresas
```bash
cd routcontrol/infra/prod
sudo docker compose --env-file .env exec backend python manage.py create_company \
  --name "Otra Empresa" --slug otra-empresa --owner-email duenio@otra.com
```

## Mapas
Los datos del mapa no están en git, porque pesan:
- `map-data/amba.pmtiles` pesa unos 31 MB;
- los datos del ruteo pesan unos 475 MB.

Hay dos opciones:
- **Copiarlos** desde esta compu:
  ```bash
  scp -r map-data usuario@servidor:routcontrol/
  ```
- **Generarlos** en el servidor:
  - teselas: ver `scripts/map/README.md`;
  - ruteo: `infra/routing/prepare.sh`.

Las fuentes y los íconos del mapa sí están en git.

## Armar mi ruta (OSRM + VROOM)
1. Prepará `map-data/routing` (ver arriba).
2. Levantá el ruteo:
   ```bash
   sudo ROUTING=1 ./infra/prod/install.sh
   ```
   O, a mano:
   ```bash
   sudo docker compose -f infra/prod/docker-compose.yml --env-file infra/prod/.env --profile routing up -d
   ```

Sin el ruteo, la app funciona igual. "Armar mi ruta" avisa que el servicio no está disponible y el orden se puede editar a mano.

## Copias de seguridad
- **Cuándo:** todos los días a las `BACKUP_HOUR` (por defecto, 3:00 hora de Argentina).
- **Qué se copia:**
  - la base, con `pg_dump` en formato custom;
  - las fotos, en un `.tar.gz`.
- **Dónde quedan:** en `infra/prod/backups/AAAA-MM-DD_HHMM/`.
- **Cuánto duran:** se borran las de más de `BACKUP_KEEP_DAYS` días (por defecto, 14).
- **Copia en el acto:**
  ```bash
  sudo docker compose -f infra/prod/docker-compose.yml --env-file infra/prod/.env exec backup bash /backup.sh now
  ```
- **Restaurar** (reemplaza los datos actuales y pide confirmación):
  ```bash
  sudo ./infra/prod/restore.sh 2026-11-03_0300
  ```
- **Copia fuera del servidor (recomendado):** las copias quedan en el mismo disco. Para tener una afuera, sincronizá `infra/prod/backups` con un almacenamiento externo, por ejemplo `rclone sync` a S3, R2 o Google Drive desde el cron del servidor. Queda pendiente elegir el destino.

## Actualizar
```bash
cd routcontrol && sudo ./infra/prod/update.sh
```
El script hace esto:
1. Una copia de seguridad.
2. `git pull`.
3. Reconstruye las imágenes y reinicia los servicios.

Las migraciones corren solas.

## Comandos útiles
```bash
cd routcontrol/infra/prod
sudo docker compose --env-file .env ps              # estado
sudo docker compose --env-file .env logs -f backend # registros del backend
sudo docker compose --env-file .env restart web     # reiniciar Caddy
```

## Probado
La stack se levantó completa en esta compu, con dominios `*.localhost` (Caddy usa un certificado propio para esos). Se probó:
- la app, el panel y las rutas de la SPA: 200;
- el mapa por rangos: 206;
- HSTS y `no-cache` en el Service Worker;
- CORS entre el panel y la API;
- login y renovación de la sesión con la cookie;
- el WebSocket del mapa en vivo: 101 desde el panel y 403 desde otro origen;
- una copia en el acto;
- **restaurar esa copia** sin errores y volver a entrar;
- `create_company`.

No se probó todavía en un servidor real con un dominio y Let's Encrypt, ni en ARM. Las imágenes son multiarquitectura; está verificado con `docker manifest`.
