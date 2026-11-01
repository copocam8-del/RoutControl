import { Alert, Brand, Button, IconArrowRight, IconEye, IconEyeOff, IconLock, IconMail, TextField } from "@routcontrol/ui";
import { type FormEvent, useState } from "react";

import { useAdmin, useSession } from "../adminApp";

/** Ingreso al panel, con el estilo de Login.dc.html (sin recuperar contraseña: llega en la etapa 1). */
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
      <span className="login__glow" aria-hidden="true" />
      <div className="login__card rc-in">
        <Brand name={config.appName} />
        {state.status === "choose_organization" ? (
          <div className="rc-stack">
            <div className="login__intro">
              <h1>¿Qué empresa querés administrar?</h1>
              <p>Tu usuario está en más de una empresa.</p>
            </div>
            {state.options.map((org) => (
              <Button key={org.id} variant="secondary" block onClick={() => void session.chooseOrganization(org.id)}>
                {org.name}
              </Button>
            ))}
          </div>
        ) : (
          <form className="login__form" onSubmit={(e) => void submit(e)}>
            <div className="login__intro">
              <h1>Panel de administración</h1>
              <p>Ingresá con tu cuenta para ver la operación.</p>
            </div>
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
            <Button type="submit" size="lg" block loading={busy} loadingLabel="Ingresando…">
              Ingresar
              <IconArrowRight />
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
