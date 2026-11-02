import { Alert, Button } from "@routcontrol/ui";

import type { DeviceInfo } from "../device/DeviceServices";

/**
 * Qué hacer cuando la ubicación está bloqueada. Un permiso denegado no se puede volver a pedir
 * desde la web: el teléfono no muestra el cartel otra vez hasta que la persona lo habilita en
 * los ajustes. Los pasos son distintos en iPhone y en Android.
 */
export function LocationHelp({
  info,
  host,
  active,
  onRetry,
}: {
  info: Pick<DeviceInfo, "platform" | "standalone">;
  /** La dirección de la app, para encontrarla en la configuración de sitios. */
  host: string;
  /** Con la jornada en curso (el permiso se quitó después de iniciar). */
  active: boolean;
  onRetry?: () => void;
}) {
  return (
    <Alert tone="error" title="La ubicación está bloqueada para esta app" className="location-help">
      <p className="location-help__lead">
        {active
          ? "La jornada sigue abierta, pero no se está registrando tu recorrido."
          : "No se puede iniciar la jornada sin ubicación. El teléfono no va a volver a preguntar: hay que habilitarla en los ajustes."}
      </p>
      {info.platform === "ios" ? <IosSteps standalone={info.standalone} /> : null}
      {info.platform === "android" ? <AndroidSteps standalone={info.standalone} host={host} /> : null}
      {info.platform === "other" ? (
        <>
          <h3 className="location-help__platform">En iPhone</h3>
          <IosSteps standalone={info.standalone} />
          <h3 className="location-help__platform">En Android</h3>
          <AndroidSteps standalone={info.standalone} host={host} />
        </>
      ) : null}
      <p className="location-help__lead">
        {active
          ? "Cuando vuelvas a la app, el recorrido se retoma solo."
          : "Después volvé a esta app y tocá «Iniciar jornada»: ahí el teléfono te va a pedir el permiso."}
      </p>
      <p className="rc-muted location-help__note">Los nombres de los menús pueden variar un poco según el modelo y la versión.</p>
      {onRetry ? (
        <Button variant="secondary" block onClick={onRetry}>
          Ya lo habilité, iniciar jornada
        </Button>
      ) : null}
    </Alert>
  );
}

function IosSteps({ standalone }: { standalone: boolean }) {
  return (
    <ol className="location-help__steps" aria-label="Pasos en iPhone">
      <li>
        Abrí <strong>Ajustes › Privacidad y seguridad › Localización</strong> y verificá que <strong>Localización</strong> esté
        activada.
      </li>
      <li>
        En esa misma lista entrá a <strong>Sitios web de Safari</strong> y elegí <strong>Mientras se usa la app</strong>. Dejá
        activada <strong>Ubicación exacta</strong>.
      </li>
      <li>
        Entrá a <strong>Ajustes › Apps › Safari › Ubicación</strong> (en iOS 17 o anterior, <strong>Ajustes › Safari › Ubicación</strong>)
        y elegí <strong>Preguntar</strong> o <strong>Permitir</strong>.
      </li>
      {standalone ? (
        <li>
          Si después de esto sigue sin preguntar, el iPhone recuerda la respuesta anterior: borrá la app de la pantalla de inicio
          y volvé a agregarla desde Safari.
        </li>
      ) : (
        <li>
          En Safari, tocá el botón de la izquierda de la barra de direcciones (<strong>aA</strong>) ›{" "}
          <strong>Configuración del sitio web › Ubicación</strong> y elegí <strong>Permitir</strong>.
        </li>
      )}
    </ol>
  );
}

function AndroidSteps({ standalone, host }: { standalone: boolean; host: string }) {
  return (
    <ol className="location-help__steps" aria-label="Pasos en Android">
      <li>
        Deslizá desde arriba para abrir los accesos rápidos y activá <strong>Ubicación</strong>.
      </li>
      {standalone ? (
        <li>
          Abrí <strong>Chrome › ⋮ › Configuración › Configuración de sitios › Ubicación</strong>, buscá{" "}
          <strong className="rc-mono">{host}</strong> en <strong>Bloqueados</strong> y cambialo a <strong>Permitir</strong>.
        </li>
      ) : (
        <li>
          En Chrome, tocá el ícono a la izquierda de la dirección › <strong>Permisos</strong> (o{" "}
          <strong>Configuración del sitio</strong>) › <strong>Ubicación</strong> y elegí <strong>Permitir</strong>.
        </li>
      )}
      <li>
        Verificá también <strong>Ajustes › Apps › Chrome › Permisos › Ubicación</strong>: tiene que estar en{" "}
        <strong>Permitir solo mientras la app está en uso</strong>.
      </li>
    </ol>
  );
}
