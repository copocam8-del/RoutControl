/**
 * Paradas del mapa de entregas (ADR-019 y ADR-020): círculo con el número grande, borde blanco
 * grueso, sombra y un brillo suave del color del estado. La próxima parada va más grande, con
 * anillos que laten y la etiqueta "Próxima"; las entregadas, más chicas y apagadas.
 *
 * El botón es el marcador (MapLibre lo ubica con `transform`) y tiene al menos 48 px para tocarlo;
 * el círculo, los anillos y la etiqueta van adentro, así las animaciones no pisan la posición.
 */
import { type MapStop, STOP_STATE_LABEL } from "@routcontrol/domain";

export function stopElement(stop: MapStop, selected: boolean, onSelect: (id: string) => void, next = false): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.innerHTML =
    '<span class="rc-stop__pulse" aria-hidden="true"></span><span class="rc-stop__pulse rc-stop__pulse--late" aria-hidden="true"></span>' +
    '<span class="rc-stop__dot"><span class="rc-stop__n"></span></span>' +
    '<span class="rc-stop__tag" aria-hidden="true">Próxima</span>';
  // Caen de a una, en el orden de la ruta (como Ruta.dc.html), hasta un segundo en total.
  (el.querySelector(".rc-stop__dot") as HTMLElement).style.animationDelay = `${Math.min(stop.n * 0.08, 1)}s`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(el.dataset.id!);
  });
  updateStopElement(el, stop, selected, next);
  return el;
}

export function updateStopElement(el: HTMLElement, stop: MapStop, selected: boolean, next = false) {
  el.dataset.id = stop.id;
  // Solo las clases propias: MapLibre le agrega las suyas al marcador (posición absoluta), y
  // pisarlas con className hace que las paradas se corran una al lado de la otra.
  for (const c of [...el.classList]) if (c.startsWith("rc-stop")) el.classList.remove(c);
  el.classList.add("rc-stop", `rc-stop--${stop.state}`);
  if (next) el.classList.add("rc-stop--next");
  if (selected) el.classList.add("rc-stop--selected");
  el.querySelector(".rc-stop__n")!.textContent = String(stop.n);
  el.setAttribute("aria-label", `${stop.label} · ${STOP_STATE_LABEL[stop.state]}${next ? " · Próxima" : ""}`);
  el.setAttribute("aria-pressed", selected ? "true" : "false");
}
