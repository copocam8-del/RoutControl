import { Alert, Button, Checkbox, TextField } from "@routcontrol/ui";
import { type FormEvent, useState } from "react";

import { Brand } from "./Brand";
import { useApp, useStore } from "./hooks";

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
      <main className="screen screen--center">
        <Brand name={config.appName} />
        <h1>¿Con qué empresa trabajás hoy?</h1>
        <div className="rc-stack">
          {state.options.map((org) => (
            <Button key={org.id} variant="secondary" size="lg" block onClick={() => void session.chooseOrganization(org.id)}>
              {org.name}
            </Button>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="screen screen--center">
      <Brand name={config.appName} />
      <p className="login-intro">Ingresá con el usuario que te dio tu empresa.</p>
      <form className="rc-stack" onSubmit={(e) => void submit(e)}>
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
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
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Checkbox label="Mostrar contraseña" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
        {state.status === "anonymous" && state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <Button type="submit" size="lg" block loading={busy} loadingLabel="Ingresando…">
          Ingresar
        </Button>
      </form>
    </main>
  );
}
