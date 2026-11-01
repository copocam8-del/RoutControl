/**
 * Aviso destacado antes de pedir la ubicación (§5.4 y §11): qué se registra, para qué, cuándo
 * empieza y cuándo termina. Es un texto provisorio: requiere revisión legal (Ley 25.326).
 */
export function ConsentDialog({ appName, onAccept, onCancel }: { appName: string; onAccept(): void; onCancel(): void }) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <h2 id="consent-title">Antes de iniciar la jornada</h2>
        <ul className="consent">
          <li>
            {appName} va a registrar tu <strong>ubicación</strong> al iniciar y al finalizar la jornada, y mientras tengas la
            app abierta.
          </li>
          <li>Se usa para el seguimiento de los repartos de tu empresa. Vos podés ver tu propio recorrido.</li>
          <li>
            <strong>Solo durante la jornada:</strong> el registro termina cuando tocás “Finalizar jornada”.
          </li>
          <li>Con la app cerrada o la pantalla bloqueada no se registra el recorrido; esos tramos quedan como huecos.</li>
        </ul>
        <p className="muted">A continuación el teléfono te va a pedir permiso para usar la ubicación.</p>
        <div className="stack">
          <button className="btn btn--primary" onClick={onAccept}>
            Entendido, iniciar jornada
          </button>
          <button className="btn btn--ghost" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
