import { type AddressHistory, OUTCOME_LABEL, type VisitOutcome } from "@routcontrol/domain";
import { Badge, EmptyState, formatDuration, formatLongDate, formatTime, IconArrowLeft, Loadable, ReceptionBadge, useLoad } from "@routcontrol/ui";
import { useCallback } from "react";

import { describeLoadError, useAdmin } from "../adminApp";
import { EvidencePhoto } from "../EvidencePhoto";
import { DemoChip, PageTitle } from "../Layout";
import { href } from "../router";
import { PackageStatusBadge } from "./Packages";

const describe = (e: unknown) => describeLoadError(e, "el domicilio");

const ATTRIBUTION: Record<string, string> = { RECIPIENT: "Del destinatario", LOGISTIC: "De logística", NONE: "—" };
const pct = (n: number) => `${Math.round(n * 100)} %`;

/**
 * Historial del domicilio (planificación §7.3 y §9.1 /domicilios/:id, ADR-022): el indicador de
 * recepción, cómo se calcula, las visitas (con fotos) y los paquetes que fueron ahí.
 */
export function AddressDetail({ id }: { id: string }) {
  const { api } = useAdmin();
  const load = useCallback(() => api.getAddress(id), [api, id]);
  const [state, reload] = useLoad<AddressHistory>(load, describe);
  return (
    <Loadable state={state} loadingLabel="Cargando el domicilio…" onRetry={reload}>
      {(h) => (
        <>
          <PageTitle
            back={
              <a className="rc-icon-btn" href={href({ name: "packages" })} aria-label="Volver a los paquetes">
                <IconArrowLeft />
              </a>
            }
            eyebrow="Domicilio"
            title={h.address.raw_text}
            description={<ReceptionBadge reception={h.reception} />}
            actions={<DemoChip />}
          />
          <section className="kpis" aria-label="Indicador de recepción">
            <div className="kpi kpi--hero">
              <span className="kpi__label">Recibe</span>
              <span className="kpi__value">{h.reception.score === null ? "—" : pct(h.reception.score)}</span>
            </div>
            <div className="kpi">
              <span className="kpi__label">Visitas que cuentan</span>
              <span className="kpi__value">{h.reception.computable}</span>
            </div>
            <div className="kpi">
              <span className="kpi__label">Entregadas</span>
              <span className="kpi__value">{h.reception.delivered}</span>
            </div>
            <div className="kpi kpi--warn">
              <span className="kpi__label">No estaba / no respondió</span>
              <span className="kpi__value">{h.reception.recipient_failures}</span>
            </div>
          </section>
          <p className="rc-muted reception-note">
            Cuentan las entregas y las fallas del destinatario (ausente, nadie responde, pidió reprogramar); las de logística no. Las visitas recientes pesan más (la de
            hace un mes vale la mitad). Verde desde {pct(h.thresholds.green)}, amarillo desde {pct(h.thresholds.yellow)}; gris con menos de {h.thresholds.min_visits}{" "}
            visitas. Es informativo: nunca impide una entrega.
          </p>

          <section className="panel-card panel-card--flush" aria-label="Visitas al domicilio">
            <h2 className="panel-card__pad">Visitas</h2>
            {h.visits.length === 0 ? (
              <EmptyState title="Todavía no hubo visitas a este domicilio." />
            ) : (
              <div className="table-wrap">
                <table className="rc-table">
                  <thead>
                    <tr>
                      <th scope="col">Fecha</th>
                      <th scope="col">Paquete</th>
                      <th scope="col">Repartidor</th>
                      <th scope="col">Resultado</th>
                      <th scope="col">Atribución</th>
                      <th scope="col">Duración</th>
                      <th scope="col">Fotos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.visits.map((v) => (
                      <tr key={v.id} className={v.voided ? "is-voided" : undefined}>
                        <td className="rc-num">
                          {formatLongDate(v.started_at)} · {formatTime(v.started_at)}
                        </td>
                        <td>
                          <a className="rc-mono" href={href({ name: "package", id: v.package.id })}>
                            {v.package.tracking_code}
                          </a>
                          {v.is_second_attempt ? " · 2.º intento" : ""}
                        </td>
                        <td>{v.driver}</td>
                        <td>
                          <Badge tone={v.outcome === "DELIVERED" ? "success" : "warning"}>{OUTCOME_LABEL[v.outcome as VisitOutcome] ?? (v.outcome || "En curso")}</Badge>
                          {v.voided ? " (anulada)" : ""}
                        </td>
                        <td>{ATTRIBUTION[v.outcome_attribution] ?? "—"}</td>
                        <td className="rc-num">{v.duration_s ? formatDuration(v.duration_s * 1000) : "—"}</td>
                        <td>
                          {v.evidence.length ? (
                            <div className="evidence-row">
                              {v.evidence.map((e) => (
                                <EvidencePhoto key={e.id} id={e.id} alt={`Foto de la visita del ${formatLongDate(v.started_at)}`} />
                              ))}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel-card" aria-label="Paquetes del domicilio">
            <h2>Paquetes</h2>
            <ul className="address-packages">
              {h.packages.map((p) => (
                <li key={p.id}>
                  <a className="rc-mono" href={href({ name: "package", id: p.id })}>
                    {p.tracking_code}
                  </a>{" "}
                  · {p.recipient_name || "Sin destinatario"} <PackageStatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </Loadable>
  );
}
