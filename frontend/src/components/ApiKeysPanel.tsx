import { useEffect, useState } from "react";
import { ApiKey, createApiKey, listApiKeys, revokeApiKey } from "../api";
import { confirmModal } from "./Modal";
import { copyToClipboard } from "../clipboard";
import { CheckIcon, LinkIcon, TrashIcon, XIcon } from "../icons";

function formatDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso.replace(" ", "T") + "Z").toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ApiKeysPanel({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  function refresh() {
    setLoading(true);
    listApiKeys()
      .then((res) => setKeys(res.keys))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setError("");
    setCreating(true);
    try {
      const created = await createApiKey(name);
      setRevealedToken(created.token);
      setNewName("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(key: ApiKey) {
    const ok = await confirmModal(`Revoke "${key.name}"? Any script using it will stop working immediately.`);
    if (!ok) return;
    await revokeApiKey(key.id);
    refresh();
  }

  async function handleCopyToken() {
    if (!revealedToken) return;
    const ok = await copyToClipboard(revealedToken);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal api-keys-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>API keys</h2>
          <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <p className="modal-sub">
          Use a key to upload images remotely — e.g. from a script or an AI coding agent — without a browser
          session. Keys can only upload; they can't browse, delete, or manage other keys.
        </p>

        {revealedToken && (
          <div className="token-reveal">
            <div className="token-reveal-label">Copy this now — it won't be shown again</div>
            <div className="token-reveal-row">
              <code>{revealedToken}</code>
              <button className={"icon-btn" + (copied ? " copied-text" : "")} title="Copy" onClick={handleCopyToken}>
                {copied ? <CheckIcon /> : <LinkIcon />}
              </button>
            </div>
          </div>
        )}

        <div className="key-create-row">
          <input
            type="text"
            placeholder="Key name, e.g. my-ai-agent"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <button className="primary" disabled={creating || !newName.trim()} onClick={handleCreate}>
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
        {error && <div className="error-msg">{error}</div>}

        <div className="key-list">
          {loading && <div className="empty-state small">Loading…</div>}
          {!loading && keys.length === 0 && <div className="empty-state small">No API keys yet.</div>}
          {keys.map((key) => (
            <div className="key-row" key={key.id}>
              <div className="key-row-main">
                <div className="key-row-name">{key.name}</div>
                <div className="key-row-meta">
                  {key.key_prefix}… &middot; created {formatDate(key.created_at)} &middot; last used{" "}
                  {formatDate(key.last_used_at)}
                </div>
              </div>
              <button className="icon-btn danger-hover" title="Revoke" aria-label={`Revoke ${key.name}`} onClick={() => handleRevoke(key)}>
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
