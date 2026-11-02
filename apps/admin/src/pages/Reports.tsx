import { type DriverSummary, REPORT_PERIOD_LABEL, type Report, type ReportPeriodKind, shiftReportDate } from "@routcontrol/domain";
import { Alert, Button, EmptyState, IconDownload, Loadable, TextField, useLoad } from "@routcontrol/ui";
import { useCallback, useEffect, useState } from "react";

import { actionError, describeLoadError, useAdmin } from "../adminApp";
import { DemoChip, PageTitle } from "../Layout";
import { href, navigate, type Route, today } from "../router";

const describe = (e: unknown) => describeLoadError(e, "el informe");
const KINDS: ReportPeriodKind[] = ["day", "week", "fortnight", "month", "range"];

const num = (n: number, digits = 0) => n.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (r: number | null) => (r === null ? "—" : `${num(r * 100, 0)} %`);

type ReportsRoute = Extract<Route, { name: "reports" }>;

/** Informes por repartidor y por empresa (ADR-024): período, tabla por repartidor y exportación. */
export function Reports({ route }: { route: ReportsRoute }) {
  const { api } = useAdmin();
  const query = { period: route.period, date: route.date, to: route.to, driver: route.driver };
  const load = useCallback(
    async () => {
      const [report, drivers] = await Promise.all([api.getReport({ period: route.period, date: route.date, to: route.to, driver: route.driver }), api.listDrivers()]);
      return { report, drivers };
    },
    [api, route.period, route.date, route.to, route.driver],
  );
  const [state, reload] = useLoad<{ report: Report; drivers: DriverSummary[] }>(load, describe);
  const [busy, setBusy] = useState<"xlsx" | "csv" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = (patch: Partial<ReportsRoute>) => navigate({ ...route, ...patch });

  async function download(formato: "xlsx" | "csv") {
    setBusy(formato);
    setError(null);
    try {
      const blob = await api.exportReport(query, formato);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = state.status === "ready" ? `informe-${state.data.report.period.from}-a-${state.data.report.period.to}.${formato}` : `informe.${formato}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(actionError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageTitle
        title="Informes"
        description={state.status === "ready" ? state.data.report.period.label : undefined}
        actions={
          <>
            <DemoChip />
            <Button variant="secondary" loading={busy === "csv"} loadingLabel="Preparando…" onClick={() => void download("csv")}>
              <IconDownload size={18} />
              CSV
            </Button>
            <Button loading={busy === "xlsx"} loadingLabel="Preparando…" onClick={() => void download("xlsx")}>
              <IconDownload size={18} />
              Excel
            </Button>
          </>
        }
      />
      <div className="filters" role="group" aria-label="Período">
        {KINDS.map((k) => (
          <a key={k} className="filter-chip" aria-pressed={route.period === k} href={href({ ...route, period: k, to: k === "range" ? route.to ?? route.date : undefined })}>
            {REPORT_PERIOD_LABEL[k]}
          </a>
        ))}
      </div>
      <div className="report-controls">
        {route.period === "range" ? (
          <RangePicker from={route.date} to={route.to ?? route.date} onApply={(from, to) => go({ date: from, to })} />
        ) : (
          <div className="day-nav" role="group" aria-label="Período">
            <button type="button" className="day-nav__btn" aria-label="Período anterior" onClick={() => go({ date: shiftReportDate(route.period, route.date, -1) })}>
              ‹
            </button>
            <span className="day-nav__label">{state.status === "ready" ? state.data.report.period.label : "…"}</span>
            <button
              type="button"
              className="day-nav__btn"
              aria-label="Período siguiente"
              disabled={shiftReportDate(route.period, route.date, 1) > today() && state.status === "ready" && state.data.report.period.to >= today()}
              onClick={() => go({ date: shiftReportDate(route.period, route.date, 1) })}
            >
              ›
            </button>
          </div>
        )}
        <label className="report-driver">
          <span className="rc-visually-hidden">Repartidor</span>
          <select className="select" value={route.driver ?? ""} onChange={(e) => go({ driver: e.target.value || undefined })}>
            <option value="">Todos los repartidores</option>
            {state.status === "ready"
              ? state.data.drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))
              : null}
          </select>
        </label>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Loadable state={state} loadingLabel="Calculando el informe…" onRetry={reload}>
        {({ report }) => <ReportBody report={report} />}
      </Loadable>
    </>
  );
}

function RangePicker({ from, to, onApply }: { from: string; to: string; onApply(from: string, to: string): void }) {
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  useEffect(() => {
    setA(from);
    setB(to);
  }, [from, to]);
  return (
    <form
      className="report-range"
      aria-label="Rango de fechas"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(a, b);
      }}
    >
      <TextField label="Desde" type="date" value={a} max={today()} onChange={(e) => setA(e.target.value)} />
      <TextField label="Hasta" type="date" value={b} max={today()} onChange={(e) => setB(e.target.value)} />
      <Button type="submit" variant="secondary">
        Ver
      </Button>
    </form>
  );
}

function ReportBody({ report }: { report: Report }) {
  const t = report.total;
  const eventsOnly = report.drivers.reduce((n, d) => n + d.events_only_workdays, 0);
  return (
    <>
      <section className="kpis" aria-label="Resumen del período">
        <div className="kpi kpi--hero">
          <span className="kpi__label">Entregados</span>
          <span className="kpi__value">
            {num(t.delivered)} <span className="kpi__of">de {num(t.delivered + t.failed)} visitas cerradas</span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi__label">Tasa de entrega</span>
          <span className="kpi__value">{pct(t.delivery_rate)}</span>
        </div>
        <div className="kpi">
          <span className="kpi__label">Km recorridos</span>
          <span className="kpi__value">{num(t.distance_km, 1)}</span>
        </div>
        <div className="kpi">
          <span className="kpi__label">Horas trabajadas</span>
          <span className="kpi__value">{num(t.hours, 1)}</span>
        </div>
      </section>
      {report.drivers.length === 0 ? (
        <section className="panel-card">
          <EmptyState title="Sin actividad en este período." description="Cuando haya jornadas o visitas, aparecen acá." />
        </section>
      ) : (
        <section className="panel-card panel-card--flush" aria-label="Por repartidor">
          <div className="table-wrap">
            <table className="rc-table report-table">
              <thead>
                <tr>
                  <th scope="col">Repartidor</th>
                  <th scope="col">Jornadas</th>
                  <th scope="col">Horas</th>
                  <th scope="col">Km</th>
                  <th scope="col">Visitas</th>
                  <th scope="col">Entregados</th>
                  <th scope="col">No entregados</th>
                  <th scope="col">Tasa</th>
                  <th scope="col">Min. por visita</th>
                  <th scope="col">2.º intentos</th>
                  <th scope="col">Sin señal</th>
                </tr>
              </thead>
              <tbody>
                {report.drivers.map((d) => (
                  <Row key={d.driver.id} name={d.driver.name} m={d} />
                ))}
              </tbody>
              <tfoot>
                <Row name="Total de la empresa" m={t} total />
              </tfoot>
            </table>
          </div>
        </section>
      )}
      <p className="rc-muted report-note">
        No entregados: entre paréntesis, los del destinatario y los de logística. Los km se suman por los tramos con señal (sin rectas por donde no hay datos).
        {eventsOnly ? ` ${eventsOnly} ${eventsOnly === 1 ? "jornada es" : "jornadas son"} de la app web (seguimiento por eventos): sus km son un mínimo.` : ""}
      </p>
    </>
  );
}

function Row({ name, m, total = false }: { name: string; m: Report["total"]; total?: boolean }) {
  const Cell = total ? "th" : "td";
  return (
    <tr className={total ? "report-table__total" : undefined}>
      <Cell scope={total ? "row" : undefined}>{name}</Cell>
      <td className="rc-num">{num(m.workdays)}</td>
      <td className="rc-num">{num(m.hours, 1)}</td>
      <td className="rc-num">{num(m.distance_km, 1)}</td>
      <td className="rc-num">{num(m.visits)}</td>
      <td className="rc-num">{num(m.delivered)}</td>
      <td className="rc-num">
        {num(m.failed)} <span className="rc-muted">({num(m.failed_recipient)}/{num(m.failed_logistic)})</span>
      </td>
      <td className="rc-num">{pct(m.delivery_rate)}</td>
      <td className="rc-num">{m.avg_visit_minutes === null ? "—" : num(m.avg_visit_minutes, 1)}</td>
      <td className="rc-num">{num(m.second_attempts)}</td>
      <td className="rc-num">{m.no_signal_minutes ? `${num(m.no_signal_minutes)} min` : "—"}</td>
    </tr>
  );
}
