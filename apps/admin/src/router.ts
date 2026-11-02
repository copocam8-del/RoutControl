/**
 * Ruteo mínimo por hash (#/…). Alcanza para las tres pantallas de la etapa 0 y funciona en
 * cualquier hosting estático sin configuración. En la etapa 1 se puede pasar a TanStack Router (§1).
 */
import type { ReportPeriodKind } from "@routcontrol/domain";
import { useEffect, useState } from "react";

export type Route =
  | { name: "dashboard" }
  | { name: "workdays"; date: string }
  | { name: "workday"; id: string }
  | { name: "drivers" }
  | { name: "packages" }
  | { name: "package"; id: string }
  | { name: "import" }
  | { name: "address"; id: string }
  | { name: "reports"; period: ReportPeriodKind; date: string; to?: string; driver?: string }
  | { name: "deliveries"; date: string; view: "deliveries" | "incidents" };

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
  if (path === "/paquetes") return { name: "packages" };
  if (path === "/paquetes/importar") return { name: "import" };
  const pkg = /^\/paquetes\/([0-9a-f-]{36})$/i.exec(path);
  if (pkg) return { name: "package", id: pkg[1]! };
  if (path === "/informes") {
    const kind = PERIOD_FROM_ES[params.get("periodo") ?? ""] ?? "week";
    const isDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const repartidor = params.get("repartidor");
    return {
      name: "reports",
      period: kind,
      date: isDate(params.get("fecha")) ?? today(),
      to: kind === "range" ? isDate(params.get("hasta")) : undefined,
      driver: repartidor && /^[0-9a-f-]{36}$/i.test(repartidor) ? repartidor : undefined,
    };
  }
  const address = /^\/domicilios\/([0-9a-f-]{36})$/i.exec(path);
  if (address) return { name: "address", id: address[1]! };
  if (path === "/entregas") {
    const date = params.get("fecha");
    return {
      name: "deliveries",
      date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today(),
      view: params.get("vista") === "incidencias" ? "incidents" : "deliveries",
    };
  }
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
    case "packages":
      return "#/paquetes";
    case "package":
      return `#/paquetes/${route.id}`;
    case "import":
      return "#/paquetes/importar";
    case "address":
      return `#/domicilios/${route.id}`;
    case "reports": {
      const q = new URLSearchParams({ periodo: PERIOD_TO_ES[route.period], fecha: route.date });
      if (route.period === "range" && route.to) q.set("hasta", route.to);
      if (route.driver) q.set("repartidor", route.driver);
      return `#/informes?${q.toString()}`;
    }
    case "deliveries":
      return `#/entregas?fecha=${route.date}${route.view === "incidents" ? "&vista=incidencias" : ""}`;
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

// Informes (ADR-024): el período en la URL, en castellano.
const PERIOD_TO_ES: Record<ReportPeriodKind, string> = { day: "dia", week: "semana", fortnight: "quincena", month: "mes", range: "rango" };
const PERIOD_FROM_ES: Record<string, ReportPeriodKind> = Object.fromEntries(Object.entries(PERIOD_TO_ES).map(([k, v]) => [v, k as ReportPeriodKind]));
