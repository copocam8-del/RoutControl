import { OUTCOME_LABEL, PACKAGE_STATUS_LABEL, type PackageEvent, type PackageStatus, type VisitOutcome } from "@routcontrol/domain";
import { Alert, Button, formatDuration, formatLongDate, formatTime, IconArrowLeft, Loadable, ReceptionBadge, useLoad } from "@routcontrol/ui";
import { useCallback, useState } from "react";

import { actionError, describeLoadError, useAdmin } from "../adminApp";
import { EvidencePhoto } from "../EvidencePhoto";
import { DemoChip, PageTitle } from "../Layout";
import { href } from "../router";
import { activeDrivers, PackageStatusBadge } from "./Packages";
import { SecondAttemptCard } from "./SecondAttemptCard";

const describe = (e: unknown) => describeLoadError(e, "el paquete");

function eventText(e: PackageEvent): string {
  const label = (s: string) => PACKAGE_STATUS_LABEL[s as PackageStatus] ?? s;
  switch (e.type) {
    case "created":
      return e.payload.source === "IMPORT" ? "Alta por importación" : "Alta manual";
    case "updated":
      return `Edición: ${Object.keys((e.payload.changes as Record<string, unknown>) ?? {}).join(", ")}`;
    case "assigned":
      return "Asignado a un repartidor";
    case "unassigned":
      return "Desasignado";
    case "status_changed": {
      const extra = e.payload.source === "scan" ? " (escaneo)" : e.payload.outcome ? ` · ${OUTCOME_LABEL[e.payload.outcome as VisitOutcome] ?? e.payload.outcome}` : e.payload.reason ? ` · ${String(e.payload.reason)}` : "";
      return `${label(e.from_status)} → ${label(e.to_status)}${extra}`;
    }
  }
}

/** Un paquete: datos, asignación, cancelar, historial y visitas con sus fotos. */
export function PackageDetail({ id }: { id: string }) {
  const { api } = useAdmin();
  const load = useCallback(async () => {
    const [pkg, events, visits, drivers] = await Promise.all([api.getPackage(id), api.packageEvents(id), api.packageVisits(id), api.listDrivers()]);
    return { pkg, events, visits, drivers: activeDrivers(drivers) };
  }, [api, id]);
  const [state, reload] = useLoad(load, describe);
  const [driverId, setDriverId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      reload();
    } catch (e) {
      setError(actionError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Loadable state={state} loadingLabel="Cargando paquete…" onRetry={reload}>
      {({ pkg, events, visits, drivers }) => {
        const assignable = ["CREATED", "ASSIGNED", "FAILED", "RESCHEDULED"].includes(pkg.status);
        const cancellable = !["DELIVERED", "RETURNED", "CANCELLED"].includes(pkg.status);
        return (
          <>
            <PageTitle
              back={
                <a className="rc-icon-btn" href={href({ name: "packages" })} aria-label="Volver a los paquetes">
                  <IconArrowLeft />
                </a>
              }
              eyebrow={pkg.tracking_code}
              title={pkg.recipient_name || pkg.tracking_code}
              description={
                <>
                  {pkg.address.raw_text} <PackageStatusBadge status={pkg.status} />
                </>
              }
              actions={<DemoChip />}
            />
            {error ? <Alert tone="error">{error}</Alert> : null}
            <div className="split">
              <section className="panel-card" aria-label="Datos del paquete">
                <h2>Datos</h2>
                <dl className="facts">
                  <dt>Domicilio</dt>
                  <dd>
                    <ReceptionBadge reception={pkg.reception} />{" "}
                    <a href={href({ name: "address", id: pkg.address.id })}>Ver historial del domicilio</a>
                  </dd>
                  <dt>Teléfono</dt>
                  <dd>{pkg.recipient_phone || "—"}</dd>
                  <dt>Observaciones</dt>
                  <dd>{pkg.notes || "—"}</dd>
                  <dt>Origen</dt>
                  <dd>{pkg.source === "IMPORT" ? "Importación" : "Alta manual"}</dd>
                  <dt>Repartidor</dt>
                  <dd>{pkg.assigned_driver?.name ?? "Sin asignar"}</dd>
                </dl>
                {assignable ? (
                  <div className="assign-row">
                    <label className="rc-visually-hidden" htmlFor="asignar-paquete">
                      Repartidor
                    </label>
                    <select id="asignar-paquete" className="select" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                      <option value="">Elegí un repartidor…</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <Button disabled={!driverId || busy} onClick={() => void run(() => api.assignPackage(pkg.id, pkg.version, driverId))}>
                      Asignar
                    </Button>
                    {pkg.assigned_driver ? (
                      <Button variant="ghost" disabled={busy} onClick={() => void run(() => api.assignPackage(pkg.id, pkg.version, null))}>
                        Desasignar
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {cancellable ? (
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`¿Cancelar el paquete ${pkg.tracking_code}? No se puede deshacer.`)) {
                        void run(() => api.setPackageStatus(pkg.id, pkg.version, "CANCELLED", "Cancelado desde el panel"));
                      }
                    }}
                  >
                    Cancelar paquete
                  </Button>
                ) : null}
              </section>
              <section className="panel-card" aria-label="Historial">
                <h2>Historial</h2>
                <ol className="timeline">
                  {events.map((e) => (
                    <li key={e.id}>
                      <span className="timeline__when">
                        {formatLongDate(e.occurred_at)} · {formatTime(e.occurred_at)}
                      </span>
                      <span>{eventText(e)}</span>
                      {e.actor ? <span className="rc-muted">{e.actor}</span> : null}
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            <SecondAttemptCard pkg={pkg} onChanged={reload} />
            <section className="panel-card" aria-label="Visitas">
              <h2>Visitas</h2>
              {visits.length === 0 ? (
                <p className="rc-muted">Todavía no hay visitas.</p>
              ) : (
                <ul className="visits">
                  {visits.map((v) => (
                    <li key={v.id} className="visit">
                      <div className="visit__head">
                        <strong>{OUTCOME_LABEL[v.outcome as VisitOutcome] ?? v.outcome}</strong>
                        <span className="rc-muted">
                          {formatLongDate(v.started_at)} · {formatTime(v.started_at)}
                          {v.duration_s !== null ? ` · ${formatDuration(v.duration_s)}` : ""} · {v.driver}
                          {v.is_second_attempt ? " · segundo intento" : ""}
                        </span>
                      </div>
                      {v.notes ? <p className="visit__notes">{v.notes}</p> : null}
                      {v.evidence.length ? (
                        <div className="evidence-row">
                          {v.evidence.map((e) => (
                            <EvidencePhoto key={e.id} id={e.id} alt={`Foto de la visita del ${formatTime(e.captured_at)}`} />
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        );
      }}
    </Loadable>
  );
}
