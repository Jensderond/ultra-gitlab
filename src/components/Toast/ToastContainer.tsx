import { useCallback, useEffect, useRef } from 'react';
import { openExternalUrl } from '../../services/transport';
import { useToast, type Toast } from './ToastContext';
import './Toast.css';

function ToastIcon({ type }: { type: Toast['type'] }) {
  switch (type) {
    case 'mr-ready':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6.5 12L2 7.5L3.4 6.1L6.5 9.2L12.6 3L14 4.4L6.5 12Z" fill="var(--success-color)" />
        </svg>
      );
    case 'pipeline-success':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="var(--success-color)" strokeWidth="1.5" fill="none" />
          <path d="M5.5 8L7 9.5L10.5 6" stroke="var(--success-color)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'pipeline-failed':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="var(--error-color)" strokeWidth="1.5" fill="none" />
          <path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="var(--error-color)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'pipeline-running':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="var(--accent-color)" strokeWidth="1.5" fill="none" />
          <path d="M8 4.5V8L10.5 9.5" stroke="var(--accent-color)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="var(--accent-color)" strokeWidth="1.5" fill="none" />
          <path d="M8 5V9M8 11V11.5" stroke="var(--accent-color)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  const handleView = useCallback(() => {
    if (toast.url) {
      openExternalUrl(toast.url).catch(console.error);
    }
    onDismiss(toast.id);
  }, [toast.url, toast.id, onDismiss]);

  // Fade-out animation before removal
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new MutationObserver(() => {
      // If element gets the fade-out class applied externally, nothing to do here
    });
    observer.observe(el, { attributes: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`toast-item toast-type-${toast.type}`}>
      <div className="toast-icon">
        <ToastIcon type={toast.type} />
      </div>
      <div className="toast-content">
        <div className="toast-title">{toast.title}</div>
        <div className="toast-body">{toast.body}</div>
      </div>
      <div className="toast-actions">
        {toast.url && (
          <button className="toast-view-btn" onClick={handleView}>
            View
          </button>
        )}
        <button className="toast-close-btn" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
}
