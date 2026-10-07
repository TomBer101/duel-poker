import { useState } from "react";
import { HelpDialog } from "./HelpDialog";
import styles from "./HelpButton.module.css";

/** Always-visible "?" button that opens the rules + hand-ranking pop-up. */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.button}
        aria-label="How to play"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      {open && <HelpDialog onClose={() => setOpen(false)} />}
    </>
  );
}
