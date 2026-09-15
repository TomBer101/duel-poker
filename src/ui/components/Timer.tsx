import { useSfxLoop } from "../sound/useSfx";
import { cn } from "../cn";
import styles from "./Timer.module.css";

/** At this many seconds left (and below), the clock pulses red and ticks. */
const PANIC_THRESHOLD_S = 5;

export type TimerProps = {
  /** "Your turn", "Opponent thinking…", etc. — always shown. */
  text: string;
  /** Seconds left in an active countdown. Omit when there is none to show. */
  secondsLeft?: number;
  className?: string;
};

/**
 * The turn indicator: static text, plus a countdown clock whenever
 * `secondsLeft` is given. The clock pulses red and starts a looping tick once
 * time is short — both stop the instant `secondsLeft` goes away (turn ends or
 * time runs out), never left dangling.
 */
export function Timer({ text, secondsLeft, className }: TimerProps) {
  const panic = secondsLeft !== undefined && secondsLeft <= PANIC_THRESHOLD_S;
  useSfxLoop("tick", panic);

  return (
    <div className={cn(styles.timer, className)}>
      {secondsLeft !== undefined && (
        <span
          className={cn(styles.clock, panic && styles.panic)}
          role="timer"
          aria-label={`${secondsLeft} second${secondsLeft === 1 ? "" : "s"} left`}
        >
          {secondsLeft}
        </span>
      )}
      <span className={styles.label}>{text}</span>
    </div>
  );
}
