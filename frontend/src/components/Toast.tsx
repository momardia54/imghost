import { useEffect, useState } from "react";
import { AlertCircleIcon, CheckCircleIcon } from "../icons";

type ToastKind = "success" | "error";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

let push: ((t: ToastItem) => void) | null = null;
let nextId = 1;

export function toast(message: string, kind: ToastKind = "success"): void {
  push?.({ id: nextId++, kind, message });
}

export function toastError(err: unknown, fallback = "Something went wrong"): void {
  toast(err instanceof Error && err.message ? err.message : fallback, "error");
}

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    push = (t) => {
      setItems((prev) => [...prev.slice(-3), t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), t.kind === "error" ? 5000 : 2400);
    };
    return () => {
      push = null;
    };
  }, []);

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "success" ? <CheckCircleIcon /> : <AlertCircleIcon />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
