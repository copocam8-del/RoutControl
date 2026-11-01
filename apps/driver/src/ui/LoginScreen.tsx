import { type FormEvent, useState } from "react";

import { useApp, useStore } from "./hooks";

export function LoginScreen() {
  const { session, config } = useApp();
  const state = useStore(session);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await session.login(email.trim(), password);
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
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Contraseña</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
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
