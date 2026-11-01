import { isWithoutSignal, type WorkdayWithDriver } from "@routcontrol/domain";
import { Avatar, Badge, formatAgo, formatDuration, formatTime } from "@routcontrol/ui";

import { navigate } from "./router";

export function WorkdayStatus({ workday, now }: { workday: WorkdayWithDriver; now: number }) {
  if (workday.status !== "ACTIVE") return <Badge tone="neutral">Finalizada</Badge>;
  if (isWithoutSignal(workday.last_point_at, workday.started_at, now)) return <Badge tone="warning">En curso · sin señal</Badge>;
  return <Badge tone="success">En curso</Badge>;
}

/** Tabla de jornadas; cada fila abre el recorrido. */
export function WorkdayTable({ workdays, now, caption }: { workdays: WorkdayWithDriver[]; now: number; caption: string }) {
  return (
    <div className="table-wrap">
      <table className="rc-table">
        <caption className="rc-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Repartidor</th>
            <th scope="col">Estado</th>
            <th scope="col">Inicio</th>
            <th scope="col">Fin</th>
            <th scope="col">Duración</th>
            <th scope="col">Última señal</th>
            <th scope="col">Puntos</th>
          </tr>
        </thead>
        <tbody>
          {workdays.map((w) => {
            const end = w.ended_at ? Date.parse(w.ended_at) : now;
            return (
              <tr key={w.id} className="rc-table__row--link" onClick={() => navigate({ name: "workday", id: w.id })}>
                <td>
                  <span className="name-cell">
                    <Avatar name={w.driver.name} size={32} />
                    <a href={`#/jornadas/${w.id}`} onClick={(e) => e.stopPropagation()}>
                      {w.driver.name}
                    </a>
                  </span>
                </td>
                <td>
                  <WorkdayStatus workday={w} now={now} />
                </td>
                <td className="rc-num">{formatTime(w.started_at)}</td>
                <td className="rc-num">{w.ended_at ? formatTime(w.ended_at) : "—"}</td>
                <td className="rc-num">{formatDuration((end - Date.parse(w.started_at)) / 1000)}</td>
                <td>{w.last_point_at ? formatAgo(Date.parse(w.last_point_at), now) : "Sin puntos"}</td>
                <td className="rc-num">{w.point_count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
