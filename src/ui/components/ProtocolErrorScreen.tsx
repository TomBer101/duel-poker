import { Link } from "react-router-dom";
import styles from "./ProtocolErrorScreen.module.css";

export type ProtocolErrorScreenProps = {
  /** Why the game halted, when known (shown under the message). */
  reason?: string | null;
  /** Overrides for a halt that is not a protocol violation (e.g. no seat). */
  title?: string;
  message?: string;
  /** Runs as the player clicks Leave (leaves the room). */
  onLeave?: () => void;
};

export function ProtocolErrorScreen({
  reason,
  title = "Protocol error",
  message = "Something in this game didn't check out, so it can't continue safely.",
  onLeave,
}: ProtocolErrorScreenProps) {
  return (
    <div className={styles.screen} role="alert" data-testid="protocol-error">
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.message}>{message}</p>
      {reason && <p className={styles.reason}>{reason}</p>}
      <Link to="/" className={styles.primary} onClick={onLeave}>
        Leave
      </Link>
    </div>
  );
}
