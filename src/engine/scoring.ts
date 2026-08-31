import { compareHands, evaluateHand } from "./poker";
import { HANDS_PER_PLAYER } from "./constants";
import type { Card, GameResult, Hand, MatchupResult } from "./types";

function handCards(hand: Hand): Card[] {
  return hand.cards.map((pc) => {
    if (!pc.card) {
      throw new Error("scoreGame: face-down card was never revealed");
    }
    return pc.card;
  });
}

/**
 * Compare the two players' hands one matchup at a time (p1.hands[i] vs
 * p2.hands[i]). Matchup winner scores 1 point; a tie scores 0 for both. The
 * game winner is whoever won more matchups; equal counts is a draw.
 */
export function scoreGame(hands: { p1: Hand[]; p2: Hand[] }): GameResult {
  const matchups: MatchupResult[] = [];
  let p1Wins = 0;
  let p2Wins = 0;

  for (let i = 0; i < HANDS_PER_PLAYER; i++) {
    const r1 = evaluateHand(handCards(hands.p1[i]));
    const r2 = evaluateHand(handCards(hands.p2[i]));
    const cmp = compareHands(r1, r2);
    let winner: MatchupResult["winner"];
    if (cmp > 0) {
      winner = "p1";
      p1Wins++;
    } else if (cmp < 0) {
      winner = "p2";
      p2Wins++;
    } else {
      winner = "tie";
    }
    matchups.push({ handIndex: i, p1: r1, p2: r2, winner });
  }

  const winner: GameResult["winner"] =
    p1Wins > p2Wins ? "p1" : p2Wins > p1Wins ? "p2" : "draw";

  return { matchups, wins: { p1: p1Wins, p2: p2Wins }, winner };
}
