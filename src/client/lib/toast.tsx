import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// A minimal toast + undo layer. `toast()` shows a transient message; if it
// carries an `undo` callback the toast renders an Undo button AND becomes the
// target for Cmd/Ctrl-Z, so the most recent undoable action is one keystroke
// away. Toasts auto-dismiss after `DURATION`.
const DURATION = 6000;

type Toast = {
  id: number;
  message: string;
  undo?: () => void;
};

type ToastApi = {
  toast: (message: string, undo?: () => void) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (message: string, undo?: () => void) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts, { id, message, undo }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION)
      );
    },
    [dismiss]
  );

  const runUndo = useCallback(
    (t: Toast) => {
      t.undo?.();
      dismiss(t.id);
    },
    [dismiss]
  );

  // Cmd/Ctrl-Z triggers the newest undoable toast. Ignored while typing so it
  // never steals the browser's in-field undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z")) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      const target = [...toasts].reverse().find((t) => t.undo);
      if (target) {
        e.preventDefault();
        runUndo(target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toasts, runUndo]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm text-foreground shadow-lg"
          >
            <span>{t.message}</span>
            {t.undo && (
              <button
                onClick={() => runUndo(t)}
                className="font-medium text-primary hover:text-primary-hover"
              >
                Undo
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
