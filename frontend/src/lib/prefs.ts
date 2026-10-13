// Per-browser UI preferences. Storage can be unavailable (private mode, blocked site data), so
// every access is guarded and falls back to the default.
export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(`imghost-${key}`);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(`imghost-${key}`, value);
  } catch {
    /* preference lasts for this session only */
  }
}
