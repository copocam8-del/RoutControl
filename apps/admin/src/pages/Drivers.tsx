import { type DriverSummary, isWithoutSignal } from "@routcontrol/domain";
import { Avatar, Badge, EmptyState, formatAgo, formatDay, formatTime, Loadable, useLoad } from "@routcontrol/ui";
import { useCallback } from "react";

import { describeLoadError, useAdmin } from "../adminApp";
import { useNow } from "../hooks";
import { DemoChip, PageTitle } from "../Layout";
import { href } from "../router";

const describe = (e: unknown) => describeLoadError(e, "los repartidores");

function DriverStatus({ driver, now }: { driver: DriverSummary; now: number }) {
  if (driver.membership_status !== "ACTIVE" || driver.status !== "ACTIVE") return <Badge tone="neutral">De baja</Badge>;
  const active = driver.active_workday;
  if (!active) return <Badge tone="info">Sin jornada</Badge>;
  if (isWithoutSignal(active.last_point_at, active.started_at, now)) return <Badge tone="warning">En jornada · sin señal</Badge>;
  return <Badge tone="success">En jornada</Badge>;
}

/** Repartidores de la empresa, con su jornada en curso y la última. */
export function Drivers() {
  const { api } = useAdmin();
  const load = useCallback(() => api.listDrivers(), [api]);
  const [state, reload] = useLoad<DriverSummary[]>(load, describe);
  const now = useNow(30_000);

  return (
    <>
      <PageTitle title="Repartidores" description="Quiénes están en jornada ahora y cuándo trabajó cada uno por última vez." actions={<DemoChip />} />
      <Loadable
        state={state}
        loadingLabel="Cargando repartidores…"
        onRetry={reload}
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState title="Todavía no hay repartidores en esta empresa." />}
      >
        {(drivers) => (
          <div className="table-wrap">
            <table className="rc-table">
              <caption className="rc-visually-hidden">Repartidores</caption>
              <thead>
                <tr>
                  <th scope="col">Repartidor</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Jornada en curso</th>
                  <th scope="col">Última jornada</th>
                  <th scope="col">Vehículo</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className="name-cell">
                        <Avatar name={d.name} size={38} />
                        <span>
                          <strong>{d.name}</strong>
                          <span className="rc-muted name-cell__sub">{d.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <DriverStatus driver={d} now={now} />
                    </td>
                    <td>
                      {d.active_workday ? (
                        <a href={href({ name: "workday", id: d.active_workday.id })}>
                          Desde las {formatTime(d.active_workday.started_at)} · última señal{" "}
                          {d.active_workday.last_point_at ? formatAgo(Date.parse(d.active_workday.last_point_at), now) : "—"}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {d.last_workday ? (
                        <a href={href({ name: "workday", id: d.last_workday.id })}>
                          {formatDay(d.last_workday.started_at)}, {formatTime(d.last_workday.started_at)}
                        </a>
                      ) : (
                        <span className="rc-muted">Nunca</span>
                      )}
                    </td>
                    <td>{d.vehicle_type || <span className="rc-muted">Sin cargar</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loadable>
    </>
  );
}
