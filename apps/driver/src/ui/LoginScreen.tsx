import { type FormEvent, useState } from "react";

import { useApp, useStore } from "./hooks";

export function LoginScreen() {
  const { session, config } = useApp();
  const state = useStore(session);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
        <h1 className="brand">{config.appName}</h1>
        <h2>¿Con qué empresa trabajás hoy?</h2>
        <div className="stack">
          {state.options.map((org) => (
            <button key={org.id} className="btn btn--secondary" onClick={() => void session.chooseOrganization(org.id)}>
              {org.name}
            </button>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="screen screen--center">
      <h1 className="brand">{config.appName}</h1>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>Email</span>
          <input
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
        </label>
        <label className="field">
          <span>Contraseña</span>
          <input
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
        </label>
        <label className="check">
          <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
          <span>Mostrar contraseña</span>
        </label>
        {state.status === "anonymous" && state.error ? (
          <p className="alert alert--error" role="alert">
            {state.error}
          </p>
        ) : null}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </main>
  );
}
