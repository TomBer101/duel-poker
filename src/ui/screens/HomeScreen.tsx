import { Link } from "react-router-dom";
import styles from "./HomeScreen.module.css";

export function HomeScreen() {
  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.title}>Chinese Poker</h1>
        <p className={styles.subtitle}>Build five hands. Beat your opponent five times over.</p>

        <div className={styles.actions}>
          <Link to="/solo" className={styles.primary}>
            Play Solo
          </Link>
          <Link to="/lobby" className={styles.secondary}>
            Create Room
          </Link>
          <Link to="/lobby" className={styles.secondary}>
            Join Room
          </Link>
        </div>
      </div>
    </div>
  );
}
