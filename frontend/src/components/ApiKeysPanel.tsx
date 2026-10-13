import { useEffect, useState } from "react";
import { ApiKey, createApiKey, listApiKeys, revokeApiKey } from "../api";
import { copyToClipboard } from "../clipboard";
import { formatDate } from "../lib/format";
import { CheckIcon, CopyIcon, KeyIcon, TrashIcon } from "../icons";
import { Dialog, confirmModal } from "./Modal";
import { toast, toastError } from "./Toast";

export default function ApiKeysPanel({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState<"token" | "curl" | null>(null);

  function refresh() {
    listApiKeys()
      .then((res) => setKeys(res.keys))
      .catch((err) => toastError(err, "Could not load API keys"))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, []);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created = await createApiKey(name);
      setRevealed(created.token);
      setNewName("");
      refresh();
    } catch (err) {
      toastError(err, "Could not create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(key: ApiKey) {
    const ok = await confirmModal({
      title: `Revoke "${key.name}"?`,
      message: "Anything using this key will stop being able to upload immediately.",
      confirmLabel: "Revoke key",
      danger: true,
    });
    if (!ok) return;
    try {
      await revokeApiKey(key.id);
      toast(`Revoked "${key.name}"`);
      refresh();
    } catch (err) {
      toastError(err, "Could not revoke key");
    }
  }

  const curl = `curl -X POST ${window.location.origin}/api/upload \\
  -H "Authorization: Bearer ${revealed ?? "imghost_sk_…"}" \\
  -F "file=@photo.png"`;

  async function copy(what: "token" | "curl") {
    const text = what === "token" ? revealed ?? "" : curl;
    if (!(await copyToClipboard(text))) return;
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <Dialog title="API keys" onClose={onClose} className="dialog-keys">
      <p className="dialog-message">
        Upload from scripts, CI or AI agents without a browser session. Keys can only upload: they can't list, move or
        delete anything.
      </p>

      {revealed && (
        <div className="token-reveal">
          <div className="token-reveal-label">Copy your new key now. It won't be shown again.</div>
          <div className="token-row">
            <code>{revealed}</code>
            <button className="icon-btn" title="Copy key" aria-label="Copy key" onClick={() => copy("token")}>
              {copied === "token" ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
        </div>
      )}

      <form
        className="key-create"
        onSubmit={(e) => {
          e.preventDefault();
          handleCreate();
        }}
      >
        <input placeholder="Key name, e.g. laptop-script" value={newName} maxLength={100} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" className="primary" disabled={creating || !newName.trim()}>
          {creating ? "Creating…" : "Create key"}
        </button>
      </form>

      <div className="key-list">
        {loading && <div className="key-empty">Loading…</div>}
        {!loading && keys.length === 0 && <div className="key-empty">No keys yet.</div>}
        {keys.map((key) => (
          <div className="key-row" key={key.id}>
            <span className="key-icon">
              <KeyIcon />
            </span>
            <div className="key-main">
              <div className="key-name">{key.name}</div>
              <div className="key-meta">
                <code>{key.key_prefix}…</code> · created {formatDate(key.created_at)} · last used {formatDate(key.last_used_at)}
              </div>
            </div>
            <button className="icon-btn danger-hover" title="Revoke" aria-label={`Revoke ${key.name}`} onClick={() => handleRevoke(key)}>
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>

      <div className="code-block">
        <div className="code-block-head">
          <span>Example</span>
          <button className="icon-btn" title="Copy command" aria-label="Copy command" onClick={() => copy("curl")}>
            {copied === "curl" ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
        <pre>{curl}</pre>
      </div>
    </Dialog>
  );
}
