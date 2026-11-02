import { type DeliveryRecord, type Incident, OUTCOME_LABEL, type VisitOutcome } from "@routcontrol/domain";
import { Alert, Badge, Button, EmptyState, formatLongDate, formatTime, Loadable, useLoad } from "@routcontrol/ui";
import { useCallback, useState } from "react";

import { actionError, describeLoadError, useAdmin } from "../adminApp";
import { EvidencePhoto } from "../EvidencePhoto";
import { DemoChip } from "../Layout";
import { href, navigate, today } from "../router";
import { dayLabel, shiftDate } from "./Workdays";

// Fuera de los componentes: useLoad vuelve a cargar si cambia la función de error.
const describeDeliveries = (e: unknown) => describeLoadError(e, "las entregas");
const describeIncidents = (e: unknown) => describeLoadError(e, "las incidencias");

/** Entregas del día e incidencias (ADR-016). */
export function Deliveries({ date, view }: { date: string; view: "deliveries" | "incidents" }) {
  return (
    <>
      <div className="page-title">
        <h1>Entregas</h1>
        <div className="page-title__actions">
          <DemoChip />
        </div>
      </div>
      <div className="filters" role="tablist" aria-label="Vista">
        <a className="filter-chip" role="tab" aria-selected={view === "deliveries"} href={href({ name: "deliveries", date, view: "deliveries" })}>
          Entregas del día
        </a>
        <a className="filter-chip" role="tab" aria-selected={view === "incidents"} href={href({ name: "deliveries", date, view: "incidents" })}>
          Incidencias
        </a>
      </div>
      {view === "deliveries" ? <DeliveriesOfDay date={date} /> : <Incidents />}
    </>
  );
}

function DeliveriesOfDay({ date }: { date: string }) {
  const { api } = useAdmin();
  const load = useCallback(() => api.listDeliveries(date), [api, date]);
  const [state, reload] = useLoad<DeliveryRecord[]>(load, describeDeliveries);
  return (
    <>
      <div className="day-nav" role="group" aria-label="Día">
        <button type="button" className="day-nav__btn" aria-label="Día anterior" onClick={() => navigate({ name: "deliveries", date: shiftDate(date, -1), view: "deliveries" })}>
          ‹
        </button>
        <span className="day-nav__label">{dayLabel(date)}</span>
        <button
          type="button"
          className="day-nav__btn"
          aria-label="Día siguiente"
          disabled={date === today()}
          onClick={() => navigate({ name: "deliveries", date: shiftDate(date, 1), view: "deliveries" })}
        >
          ›
        </button>
      </div>
      <Loadable
        state={state}
        loadingLabel="Cargando entregas…"
        onRetry={reload}
        isEmpty={(items) => items.length === 0}
        empty={
          <section className="panel-card">
            <EmptyState title="No hay visitas ese día." />
          </section>
        }
      >
        {(items) => {
          const delivered = items.filter((d) => d.outcome === "DELIVERED").length;
          return (
            <section className="panel-card panel-card--flush" aria-label="Entregas del día">
              <p className="panel-card__summary">
                {delivered} entregadas · {items.length - delivered} no entregadas
              </p>
              <div className="table-wrap">
                <table className="rc-table workdays-table">
                  <thead>
                    <tr>
                      <th scope="col">Hora</th>
                      <th scope="col">Paquete</th>
                      <th scope="col">Dirección</th>
                      <th scope="col">Repartidor</th>
                      <th scope="col">Resultado</th>
                      <th scope="col">Fotos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((d) => (
                      <tr key={d.id}>
                        <td className="rc-num">{formatTime(d.started_at)}</td>
                        <td>
                          <a className="rc-mono" href={href({ name: "package", id: d.package.id })}>
                            {d.package.tracking_code}
                          </a>
                        </td>
                        <td>{d.package.address.raw_text}</td>
                        <td>{d.driver}</td>
                        <td>
                          <Badge tone={d.outcome === "DELIVERED" ? "success" : "warning"}>{OUTCOME_LABEL[d.outcome as VisitOutcome] ?? d.outcome}</Badge>
                        </td>
                        <td className="rc-num">{d.evidence.length || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        }}
      </Loadable>
    </>
  );
}

function Incidents() {
  const { api } = useAdmin();
  const [status, setStatus] = useState<"OPEN" | "RESOLVED">("OPEN");
  const load = useCallback(() => api.listIncidents(status), [api, status]);
  const [state, reload] = useLoad<Incident[]>(load, describeIncidents);
  const [error, setError] = useState<string | null>(null);

  async function resolve(id: string) {
    setError(null);
    try {
      await api.resolveIncident(id);
      reload();
    } catch (e) {
      setError(actionError(e));
    }
  }

  return (
    <>
      <div className="filters" role="group" aria-label="Estado de las incidencias">
        <button type="button" className="filter-chip" aria-pressed={status === "OPEN"} onClick={() => setStatus("OPEN")}>
          Abiertas
        </button>
        <button type="button" className="filter-chip" aria-pressed={status === "RESOLVED"} onClick={() => setStatus("RESOLVED")}>
          Resueltas
        </button>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Loadable
        state={state}
        loadingLabel="Cargando incidencias…"
        onRetry={reload}
        isEmpty={(items) => items.length === 0}
        empty={
          <section className="panel-card">
            <EmptyState title={status === "OPEN" ? "No hay incidencias abiertas." : "No hay incidencias resueltas."} />
          </section>
        }
      >
        {(items) => (
          <ul className="incident-list" aria-label="Incidencias">
            {items.map((i) => (
              <li key={i.id} className="incident">
                <div className="incident__head">
                  <Badge tone={i.status === "OPEN" ? "warning" : "neutral"}>{OUTCOME_LABEL[i.type as VisitOutcome] ?? i.type}</Badge>
                  <span className="rc-muted">
                    {formatLongDate(i.occurred_at)} · {formatTime(i.occurred_at)} · {i.driver ?? "—"}
                  </span>
                </div>
                <a className="incident__package" href={href({ name: "package", id: i.package.id })}>
                  <strong className="rc-mono">{i.package.tracking_code}</strong> · {i.package.recipient_name || "Sin destinatario"} · {i.package.address}
                </a>
                {i.description ? <p className="incident__text">{i.description}</p> : null}
                {i.evidence.length ? (
                  <div className="evidence-row">
                    {i.evidence.map((e) => (
                      <EvidencePhoto key={e.id} id={e.id} alt={`Foto de la incidencia de ${i.package.tracking_code}`} />
                    ))}
                  </div>
                ) : null}
                {i.status === "OPEN" ? (
                  <Button variant="secondary" size="sm" onClick={() => void resolve(i.id)}>
                    Marcar resuelta
                  </Button>
                ) : (
                  <span className="rc-muted">
                    Resuelta por {i.resolved_by} el {i.resolved_at ? formatLongDate(i.resolved_at) : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Loadable>
    </>
  );
}
