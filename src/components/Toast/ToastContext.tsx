import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

export interface Toast {
  id: string;
  type: 'mr-ready' | 'pipeline-success' | 'pipeline-failed' | 'pipeline-running' | 'info';
  title: string;
  body: string;
  url?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = `toast-${++counterRef.current}`;
      const newToast: Toast = { ...toast, id };

      setToasts((prev) => {
        const next = [...prev, newToast];
        // Evict oldest if exceeding max
        if (next.length > MAX_VISIBLE) {
          const evicted = next[0];
          const timer = timersRef.current.get(evicted.id);
          if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(evicted.id);
          }
          return next.slice(next.length - MAX_VISIBLE);
        }
        return next;
      });

      // Auto-dismiss
      const timer = setTimeout(() => {
        timersRef.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
