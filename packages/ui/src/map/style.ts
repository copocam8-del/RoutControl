/**
 * Estilo del mapa, armado en el navegador con todo desde nuestro origen (ADR-008):
 * teselas OpenStreetMap en PMTiles, fuentes y sprites en `/map/`. Colores de las maquetas.
 */
import { layers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";

import type { ResolvedTheme } from "../theme";
import { color, lightColor } from "../tokens";

export interface MapSource {
  /** URL del archivo PMTiles (puede ser relativa al origen): "/map/amba.pmtiles". */
  pmtiles: string;
  /** Carpeta con `fonts/` y `sprites/`: "/map". */
  assets: string;
}

export const DEFAULT_MAP_SOURCE: MapSource = { pmtiles: "/map/amba.pmtiles", assets: "/map" };

export const absolute = (url: string) => new URL(url, globalThis.location?.href ?? "http://localhost/").href;

/** Paleta clara sobre el estilo "light" de Protomaps (modo claro, ADR-007 v3). */
function lightFlavor() {
  const light = namedFlavor("light");
  return {
    ...light,
    background: lightColor.mapBg,
    earth: lightColor.mapBg,
    water: "#BFD4F2",
    park_a: "#DCEFE3",
    park_b: "#CFE8D8",
    wood_a: "#DCEFE3",
    wood_b: "#CFE8D8",
    buildings: "#E3E7F3",
    minor_service: "#FFFFFF",
    minor_a: "#FFFFFF",
    minor_b: "#FFFFFF",
    other: "#FFFFFF",
    link: "#FFFFFF",
    major: "#FFFFFF",
    highway: "#F7F2FF",
    roads_label_minor: "#6A7299",
    roads_label_major: "#525B85",
    city_label: lightColor.muted,
    boundaries: "#C9D0EC",
  };
}

/** Paleta oscura de las maquetas sobre el estilo "dark" de Protomaps. */
function flavor() {
  const dark = namedFlavor("dark");
  return {
    ...dark,
    background: color.mapBg,
    earth: color.mapBg,
    water: "#13306B",
    park_a: "#0F1B3A",
    park_b: "#102040",
    wood_a: "#0F1B3A",
    wood_b: "#0F1B3A",
    buildings: "#10173A",
    minor_service: "#161E46",
    minor_a: "#161E46",
    minor_b: "#161E46",
    other: "#161E46",
    link: "#1B2452",
    major: "#1B2452",
    highway: "#232D63",
    bridges_minor: "#161E46",
    bridges_major: "#1B2452",
    bridges_highway: "#232D63",
    roads_label_minor: "#6E79A8",
    roads_label_major: "#8792C2",
    city_label: color.muted,
    subplace_label: "#7F8AB8",
    boundaries: "#2A3470",
  };
}

export function buildStyle(source: MapSource, theme: ResolvedTheme = "dark"): StyleSpecification {
  const assets = absolute(source.assets).replace(/\/$/, "");
  return {
    version: 8,
    glyphs: `${assets}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${assets}/sprites/${theme}`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${absolute(source.pmtiles)}`,
        attribution: '© <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    },
    layers: layers("protomaps", (theme === "light" ? lightFlavor() : flavor()) as ReturnType<typeof namedFlavor>, { lang: "es" }),
  } as StyleSpecification;
}
