import { useEffect } from "react";

/**
 * Sound-effect names. The audio files live in `public/sfx/<name>.mp3`
 * (see `public/sfx/README.md`). Missing or empty files fail silently.
 */
export type SfxName =
  | "card-draw"
  | "card-place"
  | "card-flip"
  | "tick"
  | "time-up"
  | "win"
  | "lose"
  | "draw-game";

const MUTE_KEY = "cp:muted";

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Tiny audio manager. One `HTMLAudioElement` per sound for one-shots (cloned on
 * replay so rapid repeats overlap), plus a dedicated looping element per sound.
 *
 * Browsers block audio until the first user gesture; every `play()` here catches
 * the rejection, so calls before that gesture are simply no-ops. Call
 * {@link SfxManager.unlock} from a click/tap handler to prime playback.
 */
class SfxManager {
  private muted = readMuted();
  private base = new Map<SfxName, HTMLAudioElement>();
  private loops = new Map<SfxName, HTMLAudioElement>();

  private el(name: SfxName): HTMLAudioElement | null {
    if (typeof Audio === "undefined") return null;
    let a = this.base.get(name);
    if (!a) {
      a = new Audio(`/sfx/${name}.mp3`);
      a.preload = "auto";
      this.base.set(name, a);
    }
    return a;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (muted) this.stopAllLoops();
  }

  /** Prime every sound. Safe to call repeatedly; call it from a user gesture. */
  unlock(): void {
    for (const name of [
      "card-draw",
      "card-place",
      "card-flip",
      "tick",
      "time-up",
      "win",
      "lose",
      "draw-game",
    ] as SfxName[]) {
      this.el(name)?.load();
    }
  }

  play(name: SfxName): void {
    if (this.muted) return;
    const a = this.el(name);
    if (!a) return;
    const shot = a.cloneNode() as HTMLAudioElement;
    void shot.play().catch(() => {});
  }

  /** Start a looping sound. Idempotent per name. */
  startLoop(name: SfxName): void {
    if (this.muted || this.loops.has(name)) return;
    if (typeof Audio === "undefined") return;
    const a = new Audio(`/sfx/${name}.mp3`);
    a.loop = true;
    this.loops.set(name, a);
    void a.play().catch(() => {});
  }

  stopLoop(name: SfxName): void {
    const a = this.loops.get(name);
    if (!a) return;
    a.pause();
    a.currentTime = 0;
    this.loops.delete(name);
  }

  stopAllLoops(): void {
    for (const name of [...this.loops.keys()]) this.stopLoop(name);
  }
}

export const sfx = new SfxManager();

/**
 * Hook access to the shared {@link sfx} manager. Returns stable helpers plus a
 * `loop` that auto-stops on unmount / when `active` goes false.
 */
export function useSfx() {
  return {
    play: (name: SfxName) => sfx.play(name),
    startLoop: (name: SfxName) => sfx.startLoop(name),
    stopLoop: (name: SfxName) => sfx.stopLoop(name),
    unlock: () => sfx.unlock(),
    isMuted: () => sfx.isMuted(),
    setMuted: (m: boolean) => sfx.setMuted(m),
  };
}

/** Run a looping sound for as long as `active` is true. */
export function useSfxLoop(name: SfxName, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    sfx.startLoop(name);
    return () => sfx.stopLoop(name);
  }, [name, active]);
}
