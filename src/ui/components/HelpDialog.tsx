import { useEffect, useRef, useState } from "react";
import { Card } from "./Card";
import { HAND_EXAMPLES } from "./helpExamples";
import styles from "./HelpDialog.module.css";

const SLIDES = ["Game rules", "Hand ranking"] as const;

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [slide, setSlide] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  // Swiping scrolls the snap track natively; mirror the position into `slide`.
  function onScroll() {
    const el = track.current;
    if (el) setSlide(Math.round(el.scrollLeft / el.clientWidth));
  }
  function goTo(i: number) {
    setSlide(i);
    const el = track.current;
    el?.scrollTo?.({ left: i * el.clientWidth, behavior: "smooth" });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="How to play"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{SLIDES[slide]}</h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div ref={track} className={styles.track} onScroll={onScroll}>
          <section className={styles.slide} aria-label={SLIDES[0]}>
            <Rules />
          </section>
          <section className={styles.slide} aria-label={SLIDES[1]}>
            <Ranking />
          </section>
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={`hidden-mobile ${styles.nav}`}
            disabled={slide === 0}
            onClick={() => goTo(0)}
          >
            ← Back
          </button>
          <span className={styles.dots} aria-hidden="true">
            {SLIDES.map((name, i) => (
              <span key={name} className={i === slide ? styles.dotOn : styles.dot} />
            ))}
          </span>
          <button
            type="button"
            className={`hidden-mobile ${styles.nav}`}
            disabled={slide === SLIDES.length - 1}
            onClick={() => goTo(1)}
          >
            Next →
          </button>
        </footer>
      </div>
    </div>
  );
}

function Rules() {
  return (
    <ul className={styles.rules}>
      <li>
        Chinese Poker is played like poker: you build <b>five poker hands</b> of five cards each.
      </li>
      <li>
        Each of your hands competes against <b>the opponent&apos;s hand across from it</b>. The
        better poker hand wins that matchup and scores a point; equal hands score nothing.
      </li>
      <li>
        Cards are drawn one at a time and placed on one of your hands. You may only place a card
        on a hand that <b>has the fewest cards</b>, so a new row can start only once the current
        row is full.
      </li>
      <li>
        Each hand&apos;s fifth card is placed <b>face-down</b> and revealed at the end.
      </li>
      <li>Win more of the five matchups than your opponent to win the game.</li>
    </ul>
  );
}

function Ranking() {
  return (
    <>
      <p className={styles.hint}>Strongest at the top.</p>
      <ol className={styles.ranking}>
        {HAND_EXAMPLES.map((h) => (
          <li key={h.name} className={styles.rankRow}>
            <div className={styles.rankText}>
              <span className={styles.rankName}>{h.name}</span>
              <span className={styles.rankDesc}>{h.description}</span>
            </div>
            <div className={styles.cards}>
              {h.cards.map((c) => (
                <Card key={`${c.rank}${c.suit}`} card={c} size="xs" />
              ))}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
