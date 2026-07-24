/**
 * ReAuthPrompt component.
 *
 * Modal overlay that prompts the user to re-authenticate when a
 * GitLab token has expired or been revoked.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldWarning } from '@phosphor-icons/react';
import './ReAuthPrompt.css';

interface ReAuthPromptProps {
  /** Instance ID that needs re-authentication */
  instanceId: number;
  /** URL of the GitLab instance */
  instanceUrl: string;
  /** Message explaining why re-auth is needed */
  message: string;
  /** Callback when modal is dismissed */
  onDismiss: () => void;
}

/**
 * Modal prompt for re-authentication when token expires.
 */
export default function ReAuthPrompt({
  instanceId: _instanceId, // Available for future use (e.g., pre-selecting instance in settings)
  instanceUrl,
  message,
  onDismiss,
}: ReAuthPromptProps) {
  // instanceId can be used later to pre-select the instance in settings
  void _instanceId;
  const navigate = useNavigate();
  const [isDismissing, setIsDismissing] = useState(false);

  const handleGoToSettings = () => {
    // Navigate to settings page to update the token
    navigate('/settings', { replace: true });
    onDismiss();
  };

  const handleDismiss = () => {
    setIsDismissing(true);
    // Add a small delay for the animation
    setTimeout(() => {
      onDismiss();
    }, 150);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only dismiss if clicking the backdrop, not the modal content
    if (e.target === e.currentTarget) {
      handleDismiss();
    }
  };

  return (
    <div
      className={`reauth-prompt-overlay ${isDismissing ? 'dismissing' : ''}`}
      onClick={handleBackdropClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleDismiss(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reauth-title"
    >
      <div className="reauth-prompt-modal">
        <div className="reauth-prompt-icon">
          <ShieldWarning size={48} weight="regular" />
        </div>

        <h2 id="reauth-title" className="reauth-prompt-title">
          Authentication Required
        </h2>

        <p className="reauth-prompt-message">{message}</p>

        <div className="reauth-prompt-instance">
          <span className="reauth-prompt-instance-label">Instance:</span>
          <span className="reauth-prompt-instance-url">{instanceUrl}</span>
        </div>

        <div className="reauth-prompt-actions">
          <button
            className="reauth-prompt-button primary"
            onClick={handleGoToSettings}
          >
            Go to Settings
          </button>
          <button
            className="reauth-prompt-button secondary"
            onClick={handleDismiss}
          >
            Dismiss
          </button>
        </div>

        <p className="reauth-prompt-hint">
          You'll need to generate a new personal access token from GitLab and
          update it in Settings.
        </p>
      </div>
    </div>
  );
}
