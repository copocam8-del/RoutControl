import { Alert, Button, IconArrowRight, IconEye, IconEyeOff, IconLock, IconMail, LogoMark, TextField, Wordmark } from "@routcontrol/ui";
import { type FormEvent, useState } from "react";

import { useAdmin, useSession } from "../adminApp";

/**
 * Ingreso al panel (PanelLogin.dc.html): panel violeta con el recorrido animado a la izquierda y
 * el formulario a la derecha. Sin "recuperar contraseña": llega en la etapa 1.
 */
export function Login() {
  const { session, config } = useAdmin();
  const state = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await session.login(email, password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <section className="login__art" aria-label={config.appName}>
        <svg className="login__map" viewBox="0 0 720 852" preserveAspectRatio="xMaxYMin slice" fill="none" aria-hidden="true">
          <g stroke="rgba(255,255,255,.06)" strokeWidth="10">
            <path d="M0 300 H720" />
            <path d="M0 520 H720" />
            <path d="M180 0 V852" />
            <path d="M420 0 V852" />
            <path d="M600 0 V852" />
          </g>
          <path
            className="login__trace"
            d="M120 760 L180 760 L180 520 L420 520 L420 300 L600 300 L600 140"
            stroke="#A78BFA"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="120" cy="760" r="14" fill="#34D399" stroke="#14205E" strokeWidth="5" />
          <circle cx="600" cy="140" r="16" fill="#FFFFFF" stroke="#7C5CFF" strokeWidth="7" />
          <circle cx="420" cy="520" r="9" fill="#FFFFFF" />
          <circle cx="180" cy="520" r="9" fill="#FFFFFF" />
          <circle cx="420" cy="300" r="9" fill="#FFFFFF" />
        </svg>
        <div className="login__brand">
          <LogoMark size={52} radius={16} hole="#14205E" className="login__logo" />
          <span className="login__wordmark">
            <Wordmark name={config.appName} size={24} />
          </span>
        </div>
        <div className="login__pitch">
          <h2>Toda tu operación, en un solo lugar.</h2>
          <p>Seguí a tus repartidores en el día, revisá cada recorrido y detectá a tiempo lo que no va bien.</p>
        </div>
      </section>

      <section className="login__side">
        <div className="login__box rc-in">
          {state.status === "choose_organization" ? (
            <>
              <div className="login__intro">
                <h1>¿Qué empresa querés administrar?</h1>
                <p>Tu usuario está en más de una empresa.</p>
              </div>
              <div className="rc-stack">
                {state.options.map((org) => (
                  <Button key={org.id} variant="secondary" block onClick={() => void session.chooseOrganization(org.id)}>
                    {org.name}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="login__intro">
                <h1>Hola de nuevo</h1>
                <p>Ingresá con tu cuenta de administrador o supervisor.</p>
              </div>
              <form className="login__form" onSubmit={(e) => void submit(e)}>
                <TextField
                  label="Email"
                  type="email"
                  autoComplete="username"
                  placeholder="nombre@empresa.com"
                  icon={<IconMail />}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <TextField
                  label="Contraseña"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  icon={<IconLock />}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  trailing={
                    <button
                      type="button"
                      className="rc-field__toggle"
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <IconEyeOff size={22} /> : <IconEye size={22} />}
                    </button>
                  }
                />
                {state.status === "anonymous" && state.error ? <Alert tone="error">{state.error}</Alert> : null}
                <Button type="submit" size="lg" block loading={busy} loadingLabel="Ingresando…" className="login__submit">
                  Ingresar
                  <IconArrowRight />
                </Button>
              </form>
              <p className="login__note">¿Sos repartidor? Usá la app en tu celular.</p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
