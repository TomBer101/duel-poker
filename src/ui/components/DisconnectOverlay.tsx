import { useTimer } from "../hooks/useTimer";
import styles from "./DisconnectOverlay.module.css";

const DISCONNECT_TIMEOUT_MS = 60_000;

export type DisconnectOverlayProps = {
  opponentPresent: boolean;
  onClaimWin: () => void;
};

function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function DisconnectOverlay({ opponentPresent, onClaimWin }: DisconnectOverlayProps) {
  const secondsLeft = useTimer(!opponentPresent, DISCONNECT_TIMEOUT_MS, () => {});
  if (opponentPresent) return null;

  const expired = secondsLeft <= 0;
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Opponent disconnected">
      {expired ? (
        <>
          <p className={styles.message}>Your opponent has not reconnected.</p>
          <button className={styles.primary} onClick={onClaimWin}>
            Claim win
          </button>
        </>
      ) : (
        <p className={styles.message}>Opponent reconnecting… {formatClock(secondsLeft)}</p>
      )}
    </div>
  );
}
