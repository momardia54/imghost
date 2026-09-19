import { useEffect, useRef, useState } from "react";

interface ModalRequest {
  message: string;
  withInput: boolean;
  defaultValue: string;
  resolve: (value: string | boolean | null) => void;
}

let requestModal: ((req: ModalRequest) => void) | null = null;

export function confirmModal(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    requestModal?.({
      message,
      withInput: false,
      defaultValue: "",
      resolve: (v) => resolve(Boolean(v)),
    });
  });
}

export function promptModal(message: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    requestModal?.({
      message,
      withInput: true,
      defaultValue,
      resolve: (v) => resolve(typeof v === "string" ? v : null),
    });
  });
}

export default function ModalHost() {
  const [active, setActive] = useState<ModalRequest | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (active?.withInput) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [active]);

  if (!active) return null;

  function close(result: string | boolean | null) {
    active?.resolve(result);
    setActive(null);
  }

  function onConfirm() {
    close(active?.withInput ? value.trim() || null : true);
  }

  function onCancel() {
    close(active?.withInput ? null : false);
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-message">{active.message}</div>
        {active.withInput && (
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm();
              if (e.key === "Escape") onCancel();
            }}
          />
        )}
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={onConfirm}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
