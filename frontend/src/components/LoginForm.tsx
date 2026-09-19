import { LogoMark } from "../icons";
import { FormEvent, useState } from "react";
import { UnauthorizedError, login } from "../api";

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
    <div className="center-screen">
      <div className="auth-card">
        <LogoMark className="brand-mark" />
        <h1>imghost</h1>
        <p className="sub">Log in to manage your images.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="error-msg">{error}</div>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
