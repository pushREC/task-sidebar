import { WifiOff } from "lucide-react";
import { useState } from "react";

interface OfflineCardProps {
  message?: string;
  onRetry: () => Promise<unknown> | unknown;
}

/**
 * Displayed when /api/vault fails (Sprint F E01). Shows the reason and a
 * Retry button. The button disables briefly during the retry so rapid
 * clicks don't stack five GET requests against a server that's mid-restart.
 */
export function OfflineCard({ message, onRetry }: OfflineCardProps) {
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      // Always unlock — onRetry's result determines whether the card
      // stays mounted (failure) or unmounts (success).
      setRetrying(false);
    }
  }

  return (
    <div className="offline-card" role="status" aria-live="polite">
      <WifiOff className="offline-card__icon" size={28} strokeWidth={1.5} aria-hidden="true" />
      <div className="offline-card__title">Vault offline</div>
      <div className="offline-card__hint">
        {message ?? "Couldn't reach the local server. Check that the dev server is running on port 5174."}
      </div>
      <button
        type="button"
        className="offline-card__retry press-scale"
        onClick={() => void handleRetry()}
        disabled={retrying}
        aria-busy={retrying}
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
