# Mapa autoalojado (ADR-008)

`map-data/` se sirve en `/map/` desde el mismo origen de las apps (Vite en desarrollo y vista previa; en producción, el mismo servidor estático o nginx). Nada depende de otros dominios.

| Archivo | Qué es | En git |
|---|---|---|
| `map-data/amba.pmtiles` | Teselas vectoriales de OpenStreetMap (Protomaps), zona AMBA, zoom 0–15, ~31 MB | **No** (se genera) |
| `map-data/fonts/` | Glifos Noto Sans (latín) para las etiquetas | Sí |
| `map-data/sprites/` | Íconos del estilo oscuro de Protomaps | Sí |

## Regenerar las teselas

```bash
node scripts/map/extract-region.mjs \
  --source https://build.protomaps.com/AAAAMMDD.pmtiles \
  --bbox -58.75,-34.90,-58.20,-34.45 --maxzoom 15 --out map-data/amba.pmtiles
node scripts/map/verify-archive.mjs map-data/amba.pmtiles https://build.protomaps.com/AAAAMMDD.pmtiles 10/346/617 15/11063/19746
```

Para otra zona, cambiar `--bbox` (oeste,sur,este,norte) y el nombre del archivo, y `VITE_MAP_PMTILES_URL`.

## Licencias
- Datos: © colaboradores de OpenStreetMap (ODbL). La atribución se muestra en el mapa.
- Teselas: build de Protomaps (datos OSM).
- Glifos Noto Sans: SIL Open Font License. Íconos: protomaps/basemaps-assets.
