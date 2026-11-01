import { Alert, Brand, Button, IconArrowRight, IconEye, IconEyeOff, IconLock, IconMail, IconShield, TextField } from "@routcontrol/ui";
import { type FormEvent, useState } from "react";

import { useApp, useStore } from "./hooks";

/** Ingresar (Login.dc.html). La recuperación de contraseña llega en la etapa 1: no hay enlace todavía. */
export function LoginScreen() {
  const { session, config } = useApp();
  const state = useStore(session);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      // El servidor también normaliza el email; la contraseña se manda tal cual.
      await session.login(email.trim().toLowerCase(), password);
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "choose_organization") {
    return (
      <main className="screen login">
        <span className="login__glow" aria-hidden="true" />
        <div className="rc-in">
          <Brand name={config.appName} />
        </div>
        <div className="login__intro rc-in" style={{ animationDelay: ".08s" }}>
          <h1>¿Con qué empresa trabajás hoy?</h1>
          <p>Tu usuario está en más de una empresa.</p>
        </div>
        <div className="rc-stack rc-in" style={{ animationDelay: ".16s" }}>
          {state.options.map((org) => (
            <Button key={org.id} variant="secondary" block onClick={() => void session.chooseOrganization(org.id)}>
              {org.name}
            </Button>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="screen login">
      <span className="login__glow" aria-hidden="true" />
      <div className="rc-in">
        <Brand name={config.appName} />
      </div>
      <div className="login__intro rc-in" style={{ animationDelay: ".08s" }}>
        <h1>Hola de nuevo</h1>
        <p>Ingresá con tu cuenta para empezar tu jornada.</p>
      </div>
      <form className="login__form" onSubmit={(e) => void submit(e)}>
        <div className="login__fields rc-in" style={{ animationDelay: ".16s" }}>
          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            placeholder="nombre@empresa.com"
            icon={<IconMail />}
            // Los teclados de los teléfonos ponen mayúscula inicial y "corrigen" palabras.
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
            name="password"
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
        </div>
        <div className="login__bottom rc-in" style={{ animationDelay: ".24s" }}>
          <Button type="submit" size="lg" block loading={busy} loadingLabel="Ingresando…">
            Ingresar
            <IconArrowRight />
          </Button>
          <p className="login__privacy">
            <IconShield size={16} />
            Tu ubicación solo se registra durante tu jornada.
          </p>
        </div>
      </form>
    </main>
  );
}
