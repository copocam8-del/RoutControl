/** Casitas del mapa de entregas (ADR-019): el elemento de cada marcador. */
import { type MapStop, STOP_STATE_LABEL } from "@routcontrol/domain";

// Casita: techo a dos aguas y cuerpo con una punta abajo (marca el domicilio), con el número
// adentro: el mismo lenguaje que el número de parada de Jornada.dc.html, en el color del estado.
const HOUSE_SVG =
  '<svg class="rc-stop__house" viewBox="0 0 40 46" aria-hidden="true"><path d="M20 2 3 16v20a4 4 0 0 0 4 4h8l5 5 5-5h8a4 4 0 0 0 4-4V16Z"/></svg>';

export function stopElement(stop: MapStop, selected: boolean, onSelect: (id: string) => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.innerHTML = `${HOUSE_SVG}<span class="rc-stop__n"></span>`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(el.dataset.id!);
  });
  updateStopElement(el, stop, selected);
  return el;
}

export function updateStopElement(el: HTMLElement, stop: MapStop, selected: boolean) {
  el.dataset.id = stop.id;
  // Solo las clases propias: MapLibre le agrega las suyas al marcador (posición absoluta), y
  // pisarlas con className hace que las casitas se corran una al lado de la otra.
  for (const c of [...el.classList]) if (c.startsWith("rc-stop")) el.classList.remove(c);
  el.classList.add("rc-stop", `rc-stop--${stop.state}`);
  if (selected) el.classList.add("rc-stop--selected");
  el.querySelector(".rc-stop__n")!.textContent = String(stop.n);
  el.setAttribute("aria-label", `${stop.label} · ${STOP_STATE_LABEL[stop.state]}`);
  el.setAttribute("aria-pressed", selected ? "true" : "false");
}
