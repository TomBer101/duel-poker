import { Link } from "react-router-dom";
import styles from "./ProtocolErrorScreen.module.css";

export type ProtocolErrorScreenProps = {
  /** Why the game halted, when known (shown under the message). */
  reason?: string | null;
};

export function ProtocolErrorScreen({ reason }: ProtocolErrorScreenProps) {
  return (
    <div className={styles.screen} role="alert" data-testid="protocol-error">
      <h1 className={styles.title}>Protocol error</h1>
      <p className={styles.message}>
        Something in this game didn&apos;t check out, so it can&apos;t continue safely.
      </p>
      {reason && <p className={styles.reason}>{reason}</p>}
      <Link to="/" className={styles.primary}>
        Leave
      </Link>
    </div>
  );
}
