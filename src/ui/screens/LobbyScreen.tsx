import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLobby } from "../hooks/useLobby";
import styles from "./LobbyScreen.module.css";

export function LobbyScreen() {
  const { roomId: roomIdFromRoute } = useParams();
  const navigate = useNavigate();
  const lobby = useLobby();

  const [nick, setNick] = useState("");
  const [password, setPassword] = useState("");
  const [joinCode, setJoinCode] = useState(roomIdFromRoute?.toUpperCase() ?? "");

  if (lobby.roomId) {
    return (
      <div className={styles.screen}>
        <div className={styles.card}>
          <h1 className={styles.title}>Waiting for your opponent…</h1>

          <p className={styles.label}>Room code</p>
          <p className={styles.roomCode}>{lobby.roomId}</p>
          <p className={styles.hint}>Share this code with your friend so they can join.</p>

          <p className={styles.presence}>
            {lobby.opponentPresent ? "Opponent has joined!" : "Waiting for opponent…"}
          </p>

          <button
            type="button"
            className={styles.primary}
            disabled={!lobby.opponentPresent}
            onClick={() => navigate(`/room/${lobby.roomId}`)}
          >
            Start Game
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.title}>Multiplayer</h1>

        {lobby.error && (
          <p role="alert" className={styles.error}>
            {lobby.error}
          </p>
        )}

        <div className={styles.form}>
          <label className={styles.field}>
            Nickname
            <input value={nick} onChange={(e) => setNick(e.target.value)} required />
          </label>
          <label className={styles.field}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <label className={styles.field}>
            Room Code (to join an existing room)
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
          </label>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={lobby.busy || !nick || !password}
              onClick={() => lobby.create(nick, password)}
            >
              Create Room
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={lobby.busy || !nick || !password || !joinCode}
              onClick={() => lobby.join(joinCode.toUpperCase(), nick, password)}
            >
              Join Room
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
