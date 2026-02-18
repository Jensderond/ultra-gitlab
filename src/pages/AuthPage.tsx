/**
 * PIN authentication page for the mobile companion server.
 *
 * Shown when accessing the app via the companion HTTP server in a browser.
 * Accepts a 6-digit PIN, verifies against the server, and redirects to /mrs on success.
 * Supports auto-auth via ?pin= query parameter (QR code flow).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useCompanionAuth from '../hooks/useCompanionAuth';
import './AuthPage.css';

export default function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const companionAuth = useCompanionAuth();
  const checkingSession = companionAuth.isChecking;
  const inputRef = useRef<HTMLInputElement>(null);
  const autoAuthAttempted = useRef(false);

  // If already authenticated, redirect to MR list
  useEffect(() => {
    if (companionAuth.isAuthenticated === true) {
      navigate('/mrs', { replace: true });
    }
  }, [companionAuth.isAuthenticated, navigate]);

  // Submit PIN to the verify endpoint
  const submitPin = useCallback(async (pinValue: string) => {
    if (pinValue.length !== 6) {
      setError('PIN must be 6 digits');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinValue }),
        credentials: 'include',
      });

      if (res.ok) {
        navigate('/mrs', { replace: true });
        return;
      }

      const body = await res.json().catch(() => ({ code: 'UNKNOWN', message: 'Authentication failed' }));

      if (res.status === 429) {
        setError('Too many attempts. Try again in 1 minute.');
      } else if (res.status === 401) {
        setError('Incorrect PIN. Please try again.');
      } else {
        setError(body.message || 'Authentication failed');
      }

      setPin('');
      inputRef.current?.focus();
    } catch {
      setError('Could not reach the server. Make sure your desktop app is running.');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  // Auto-auth flow: if ?pin= query param is present, auto-submit
  useEffect(() => {
    if (checkingSession || autoAuthAttempted.current) return;
    const pinParam = searchParams.get('pin');
    if (pinParam && pinParam.length === 6) {
      autoAuthAttempted.current = true;
      setPin(pinParam);
      submitPin(pinParam);
    }
  }, [checkingSession, searchParams, submitPin]);

  // Focus the input on mount
  useEffect(() => {
    if (!checkingSession) {
      inputRef.current?.focus();
    }
  }, [checkingSession]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitPin(pin);
  }

  function handlePinChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setPin(value);
    setError('');
  }

  if (checkingSession) {
    return (
      <div className="auth-page">
        <div className="auth-loading">
          <div className="auth-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-title">Ultra GitLab</h1>
          <p className="auth-subtitle">Enter the PIN shown in your desktop app</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            value={pin}
            onChange={handlePinChange}
            className="auth-pin-input"
            placeholder="000000"
            disabled={loading}
            aria-label="6-digit PIN"
          />

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={loading || pin.length !== 6}
          >
            {loading ? 'Verifying…' : 'Connect'}
          </button>
        </form>

        <p className="auth-hint">
          Open Settings → Companion Server in the desktop app to find the PIN.
        </p>
      </div>
    </div>
  );
}
