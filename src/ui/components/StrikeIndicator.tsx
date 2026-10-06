import { cn } from "../cn";
import styles from "./StrikeIndicator.module.css";

export type StrikeIndicatorProps = {
  strikes: number;
  max: number;
};

export function StrikeIndicator({ strikes, max }: StrikeIndicatorProps) {
  return (
    <div className={styles.row} role="img" aria-label={`${strikes} of ${max} strikes`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          data-testid={`strike-dot-${i}`}
          data-filled={i < strikes}
          className={cn(styles.dot, i < strikes && styles.filled)}
        />
      ))}
    </div>
  );
}
