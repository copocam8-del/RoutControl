import type { ColumnMapping, ImportJob, ImportPreview } from "@routcontrol/domain";
import { Alert, Button, IconArrowLeft } from "@routcontrol/ui";
import { useState } from "react";

import { actionError, useAdmin } from "../adminApp";
import { DemoChip, PageTitle } from "../Layout";
import { href } from "../router";

/**
 * Importar paquetes (ADR-012): subir el archivo → elegir qué columna es cada dato (con una
 * sugerencia) → revisar los errores por fila → importar las filas válidas.
 */
export function Import() {
  const { api } = useAdmin();
  const [job, setJob] = useState<ImportJob | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (e) {
      setError(actionError(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    const uploaded = await run(() => api.uploadImport(file, file.name));
    if (uploaded) {
      setJob(uploaded);
      setMapping(uploaded.suggested_mapping);
      setPreview(null);
      setResult(null);
    }
  }

  async function review() {
    if (job) setPreview(await run(() => api.previewImport(job.id, mapping)));
  }

  async function confirm() {
    if (job) setResult(await run(() => api.confirmImport(job.id, mapping)));
  }

  return (
    <>
      <PageTitle
        back={
          <a className="rc-icon-btn" href={href({ name: "packages" })} aria-label="Volver a los paquetes">
            <IconArrowLeft />
          </a>
        }
        title="Importar paquetes"
        description="CSV (separado por coma o punto y coma) o Excel .xlsx. La primera fila tiene que ser el encabezado."
        actions={<DemoChip />}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}

      {result ? (
        <section className="panel-card" aria-label="Resultado">
          <h2>Importación terminada</h2>
          <p>
            Se crearon <strong>{result.ok_rows}</strong> paquetes. {result.error_rows ? `${result.error_rows} filas no se importaron.` : ""}
          </p>
          {result.errors.length ? <ErrorTable errors={result.errors} /> : null}
          <div className="form-actions">
            <a className="rc-btn rc-btn--primary" href={href({ name: "packages" })}>
              Ver los paquetes
            </a>
          </div>
        </section>
      ) : (
        <>
          <section className="panel-card" aria-label="Archivo">
            <h2>1. Archivo</h2>
            <label className="file-pick">
              <span className="rc-btn rc-btn--secondary">{job ? "Elegir otro archivo" : "Elegir archivo"}</span>
              <input
                type="file"
                accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="rc-visually-hidden"
                aria-label="Archivo para importar"
                disabled={busy}
                onChange={(e) => void upload(e.target.files?.[0])}
              />
              {job ? (
                <span className="rc-muted">
                  {job.filename} · {job.total_rows} filas
                </span>
              ) : null}
            </label>
          </section>

          {job ? (
            <section className="panel-card" aria-label="Columnas">
              <h2>2. ¿Qué columna es cada dato?</h2>
              <p className="rc-muted">Ya sugerimos las que reconocimos por el nombre. Revisalas.</p>
              <div className="mapping">
                {job.fields.map((f) => (
                  <label key={f.key} className="mapping__row">
                    <span>
                      {f.label}
                      {f.required ? " *" : ""}
                    </span>
                    <select
                      className="select"
                      value={mapping[f.key] ?? ""}
                      onChange={(e) => {
                        setMapping((m) => ({ ...m, [f.key]: e.target.value || null }));
                        setPreview(null);
                      }}
                    >
                      <option value="">— No usar —</option>
                      {job.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {job.sample.length ? (
                <div className="table-wrap">
                  <table className="rc-table sample-table">
                    <caption className="rc-visually-hidden">Primeras filas del archivo</caption>
                    <thead>
                      <tr>
                        {job.headers.map((h) => (
                          <th key={h} scope="col">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {job.sample.slice(0, 5).map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="form-actions">
                <Button onClick={() => void review()} loading={busy && !preview} loadingLabel="Revisando…">
                  Revisar las filas
                </Button>
              </div>
            </section>
          ) : null}

          {preview ? (
            <section className="panel-card" aria-label="Revisión">
              <h2>3. Revisión</h2>
              <p>
                <strong>{preview.summary.ok_rows}</strong> filas listas para importar
                {preview.summary.error_rows ? (
                  <>
                    {" "}
                    y <strong>{preview.summary.error_rows}</strong> con errores (no se importan)
                  </>
                ) : null}
                .
              </p>
              {preview.errors.length ? <ErrorTable errors={preview.errors} /> : null}
              <div className="form-actions">
                <Button disabled={!preview.summary.ok_rows || busy} loading={busy} loadingLabel="Importando…" onClick={() => void confirm()}>
                  Importar {preview.summary.ok_rows} paquetes
                </Button>
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

function ErrorTable({ errors }: { errors: Array<{ row: number; field: string; message: string }> }) {
  return (
    <div className="table-wrap">
      <table className="rc-table">
        <caption className="rc-visually-hidden">Errores por fila</caption>
        <thead>
          <tr>
            <th scope="col">Fila</th>
            <th scope="col">Problema</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((e, i) => (
            <tr key={`${e.row}-${e.field}-${i}`}>
              <td className="rc-num">{e.row}</td>
              <td>{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
