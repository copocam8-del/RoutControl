"""Polilíneas codificadas (formato de Google/OSRM, precisión 5) para la geometría de la ruta."""

from __future__ import annotations


def decode(text: str, precision: int = 5) -> list[tuple[float, float]]:
    """Devuelve [(lat, lng), ...]."""
    coords: list[tuple[float, float]] = []
    index = lat = lng = 0
    factor = 10**precision
    while index < len(text):
        for axis in (0, 1):
            shift = result = 0
            while True:
                b = ord(text[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if axis == 0:
                lat += delta
            else:
                lng += delta
        coords.append((lat / factor, lng / factor))
    return coords


def encode(coords: list[tuple[float, float]], precision: int = 5) -> str:
    factor = 10**precision
    out: list[str] = []
    prev_lat = prev_lng = 0
    for lat, lng in coords:
        ilat, ilng = round(lat * factor), round(lng * factor)
        for delta in (ilat - prev_lat, ilng - prev_lng):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        prev_lat, prev_lng = ilat, ilng
    return "".join(out)


def split_at(coords: list[tuple[float, float]], stops: list[tuple[float, float]]) -> list[list[tuple[float, float]]]:
    """Corta la línea en un tramo por parada: del punto anterior hasta el vértice más cercano a cada
    parada, buscando siempre hacia adelante (la ruta las visita en ese orden)."""
    legs: list[list[tuple[float, float]]] = []
    start = 0
    for lat, lng in stops:
        if start >= len(coords):
            legs.append([])
            continue
        best = min(range(start, len(coords)), key=lambda i: (coords[i][0] - lat) ** 2 + (coords[i][1] - lng) ** 2)
        legs.append(coords[start : best + 1])
        start = best
    return legs
