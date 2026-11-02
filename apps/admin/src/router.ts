/**
 * Ruteo mínimo por hash (#/…). Alcanza para las tres pantallas de la etapa 0 y funciona en
 * cualquier hosting estático sin configuración. En la etapa 1 se puede pasar a TanStack Router (§1).
 */
import { useEffect, useState } from "react";

export type Route =
  | { name: "dashboard" }
  | { name: "workdays"; date: string }
  | { name: "workday"; id: string }
  | { name: "drivers" };

/** Fecha local AAAA-MM-DD (la del navegador; la empresa trabaja en su zona horaria). */
export function today(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query);
  const workday = /^\/jornadas\/([0-9a-f-]{36})$/i.exec(path);
  if (workday) return { name: "workday", id: workday[1]! };
  if (path === "/jornadas") {
    const date = params.get("fecha");
    return { name: "workdays", date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today() };
  }
  if (path === "/repartidores") return { name: "drivers" };
  return { name: "dashboard" };
}

export function href(route: Route): string {
  switch (route.name) {
    case "dashboard":
      return "#/";
    case "workdays":
      return `#/jornadas?fecha=${route.date}`;
    case "workday":
      return `#/jornadas/${route.id}`;
    case "drivers":
      return "#/repartidores";
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
