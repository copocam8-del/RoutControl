/**
 * Paradas del mapa de entregas (ADR-019), con el estilo de Ruta.dc.html: círculo con el número en
 * negrita y borde blanco, en el color del estado, que "cae" al aparecer.
 *
 * El botón es el marcador (MapLibre lo ubica con `transform`) y tiene 44 px para tocarlo con el
 * dedo; el círculo visible va adentro, así la animación y el agrandado de la elegida no pisan la
 * posición.
 */
import { type MapStop, STOP_STATE_LABEL } from "@routcontrol/domain";

export function stopElement(stop: MapStop, selected: boolean, onSelect: (id: string) => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.innerHTML = '<span class="rc-stop__dot"><span class="rc-stop__n"></span></span>';
  // Caen de a una, en el orden de la ruta (como la maqueta), hasta un segundo en total.
  (el.firstElementChild as HTMLElement).style.animationDelay = `${Math.min(stop.n * 0.08, 1)}s`;
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
  // pisarlas con className hace que las paradas se corran una al lado de la otra.
  for (const c of [...el.classList]) if (c.startsWith("rc-stop")) el.classList.remove(c);
  el.classList.add("rc-stop", `rc-stop--${stop.state}`);
  if (selected) el.classList.add("rc-stop--selected");
  el.querySelector(".rc-stop__n")!.textContent = String(stop.n);
  el.setAttribute("aria-label", `${stop.label} · ${STOP_STATE_LABEL[stop.state]}`);
  el.setAttribute("aria-pressed", selected ? "true" : "false");
}
