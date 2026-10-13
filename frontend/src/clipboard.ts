const CLIPBOARD_TIMEOUT_MS = 2000;

function legacyCopy(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

// navigator.clipboard.writeText() can hang indefinitely (never resolve or reject)
// if the browser is waiting on a permission prompt with no user present to answer
// it — race it against a timeout so a click can never freeze the UI, and fall back
// to the legacy execCommand path (synchronous, no permission prompt) on failure.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) => setTimeout(() => reject(new Error("clipboard timeout")), CLIPBOARD_TIMEOUT_MS)),
      ]);
      return true;
    }
  } catch {
    // fall through to legacy fallback below
  }
  return legacyCopy(text);
}
