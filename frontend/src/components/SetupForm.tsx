import { FormEvent, useState } from "react";
import { setup } from "../api";

export default function SetupForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await setup(username.trim(), password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <h1>Welcome to imghost</h1>
        <p className="sub">Create the admin account to get started.</p>
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
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="error-msg">{error}</div>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? "Creating…" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
