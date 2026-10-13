import { FormEvent, ReactNode, useState } from "react";
import { UnauthorizedError, login } from "../api";
import { LogoMark } from "../icons";
import ThemeToggle from "./ThemeToggle";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-backdrop" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <ThemeToggle className="auth-theme" />
      <div className="auth-card">
        <div className="auth-brand">
          <LogoMark />
          <span>imghost</span>
        </div>
        {children}
      </div>
      <footer className="auth-footer">v{__APP_VERSION__} · self-hosted on Cloudflare</footer>
    </div>
  );
}

export default function LoginForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      onDone();
    } catch (err) {
      if (err instanceof UnauthorizedError) setError("Invalid username or password.");
      else setError(err instanceof Error && err.message ? err.message : "Login failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <h1>Welcome back</h1>
      <p className="auth-sub">Sign in to manage your images.</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="username">Username</label>
        <input id="username" type="text" autoComplete="username" autoFocus required value={username} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="primary block" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}
