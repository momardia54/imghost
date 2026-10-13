import { ReactNode, useEffect, useRef, useState } from "react";
import { XIcon } from "../icons";

interface ModalOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  placeholder?: string;
}

interface ModalRequest extends ModalOptions {
  withInput: boolean;
  defaultValue: string;
  resolve: (value: string | boolean | null) => void;
}

let requestModal: ((req: ModalRequest) => void) | null = null;

// Never use window.confirm/prompt: they freeze the tab and block browser automation.
export function confirmModal(options: ModalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    requestModal?.({ ...options, withInput: false, defaultValue: "", resolve: (v) => resolve(Boolean(v)) });
  });
}

export function promptModal(options: ModalOptions, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    requestModal?.({
      ...options,
      withInput: true,
      defaultValue,
      resolve: (v) => resolve(typeof v === "string" ? v : null),
    });
  });
}

// Shared dialog chrome: backdrop, Escape to close, click outside to close.
export function Dialog({
  title,
  onClose,
  children,
  className = "",
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-header">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" title="Close" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}

export default function ModalHost() {
  const [active, setActive] = useState<ModalRequest | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    requestModal = (req) => {
      setValue(req.defaultValue);
      setActive(req);
    };
    return () => {
      requestModal = null;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    if (active.withInput) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      confirmRef.current?.focus();
    }
  }, [active]);

  if (!active) return null;

  function close(result: string | boolean | null) {
    active?.resolve(result);
    setActive(null);
  }

  const onConfirm = () => close(active.withInput ? value.trim() || null : true);
  const onCancel = () => close(active.withInput ? null : false);

  return (
    <Dialog
      title={active.title}
      onClose={onCancel}
      className="dialog-sm"
      footer={
        <>
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            className={active.danger ? "danger" : "primary"}
            disabled={active.withInput && !value.trim()}
            onClick={onConfirm}
          >
            {active.confirmLabel ?? "OK"}
          </button>
        </>
      }
    >
      {active.message && <p className="dialog-message">{active.message}</p>}
      {active.withInput && (
        <input
          ref={inputRef}
          type="text"
          maxLength={100}
          placeholder={active.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onConfirm();
          }}
        />
      )}
    </Dialog>
  );
}
