import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, CheckCircle, XCircle, Clock, Info } from '@phosphor-icons/react';
import { openExternalUrl } from '../../services/transport';
import { CloseIcon } from '../icons';
import { useToast, type Toast } from './ToastContext';
import './Toast.css';

function ToastIcon({ type }: { type: Toast['type'] }) {
  switch (type) {
    case 'mr-ready':
      return <Check size={16} weight="bold" color="var(--success-color)" />;
    case 'pipeline-success':
      return <CheckCircle size={16} weight="bold" color="var(--success-color)" />;
    case 'pipeline-failed':
      return <XCircle size={16} weight="bold" color="var(--error-color)" />;
    case 'pipeline-running':
      return <Clock size={16} weight="bold" color="var(--accent-color)" />;
    default:
      return <Info size={16} weight="bold" color="var(--accent-color)" />;
  }
}

function ToastItem({ toast, onDismiss, onNavigate }: { toast: Toast; onDismiss: (id: string) => void; onNavigate: (route: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  const handleView = useCallback(() => {
    if (toast.route) {
      onNavigate(toast.route);
    } else if (toast.url) {
      openExternalUrl(toast.url).catch(console.error);
    }
    onDismiss(toast.id);
  }, [toast.route, toast.url, toast.id, onDismiss, onNavigate]);

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
        {(toast.route || toast.url) && (
          <button className="toast-view-btn" onClick={handleView}>
            View
          </button>
        )}
        <button className="toast-close-btn" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
          <CloseIcon size={12} />
        </button>
      </div>
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();
  const navigate = useNavigate();

  const handleNavigate = useCallback((route: string) => {
    navigate(route, { replace: true });
  }, [navigate]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} onNavigate={handleNavigate} />
      ))}
    </div>
  );
}
