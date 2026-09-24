// Pure type declarations for the game engine. No runtime values live here —
// constants are in constants.ts, helper functions in deck.ts / poker.ts / etc.

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type Suit = "Hearts" | "Diamonds" | "Clubs" | "Spades";

/**
 * Rank is 2..14. Ace is 14 (high). The ace-low straight (A-2-3-4-5) is handled
 * as a special case in poker evaluation. This differs from the spec's "1 = Ace"
 * note — ace-high integers make comparison logic dramatically simpler.
 */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type Card = {
  suit: Suit;
  rank: Rank;
};

// ---------------------------------------------------------------------------
// Poker evaluation
// ---------------------------------------------------------------------------

export type HandCategory = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type HandRank = {
  category: HandCategory;
  /**
   * Ordered rank values for breaking ties within a category, most significant
   * first. Two HandRanks compare by category, then by this array lexically.
   */
  tiebreakers: number[];
};

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type PlayerId = "p1" | "p2";
export type GameMode = "multiplayer" | "solo";

export type GamePhase =
  | "lobby"
  | "shuffling"
  | "placing"
  | "replace"
  | "reveal"
  | "result";

export type PlacedCard =
  | { card: Card; faceUp: true }
  | { card?: Card; faceUp: false; commitment?: string };

export type Hand = {
  cards: PlacedCard[]; // 0..5 cards
};

export type MatchupResult = {
  handIndex: number;
  p1: HandRank;
  p2: HandRank;
  winner: PlayerId | "tie";
};

export type GameResult = {
  matchups: MatchupResult[];
  wins: { p1: number; p2: number };
  winner: PlayerId | "draw";
};

export type GameState = {
  mode: GameMode;
  phase: GamePhase;
  turn: PlayerId;
  /**
   * How many cards have been drawn so far (0..52). The engine does NOT hold the
   * deck: the drawn card arrives on the DRAW event (from the local shuffle in
   * solo, from the commit-reveal protocol in multiplayer).
   */
  drawCount: number;
  hands: Record<PlayerId, Hand[]>;
  strikes: Record<PlayerId, number>;
  /** Card drawn this turn, not yet committed to a hand. */
  pendingCard: Card | null;
  /** Whether each player has taken their replace-phase action. */
  replaceDone: Record<PlayerId, boolean>;
  /** During the reveal phase: how many matchups have been revealed (0..5). */
  revealIndex: number;
  /** Computed when entering the reveal phase. */
  result: GameResult | null;
  /** Set when a game ends by forfeit (3 strikes). */
  forfeitedBy: PlayerId | null;
};

// ---------------------------------------------------------------------------
// Events — the append-only log that is the source of truth. Every event
// carries enough data to be replayed without any external state.
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: "DEAL"; cards: Record<PlayerId, Card[]> }
  | { type: "DRAW"; by: PlayerId; card: Card }
  | { type: "END_TURN"; by: PlayerId; handIndex: number; faceDown: boolean }
  | { type: "TIMEOUT"; by: PlayerId; card: Card }
  | { type: "REPLACE_DRAW"; by: PlayerId; card: Card }
  | { type: "REPLACE"; by: PlayerId; handIndex: number | null }
  /** Place a card the local client does not know (opponent's face-down card). */
  | { type: "PLACE_HIDDEN"; by: PlayerId; handIndex: number }
  /** Replace-phase equivalent of PLACE_HIDDEN; the drawn card is unknown. */
  | { type: "REPLACE_HIDDEN"; by: PlayerId; handIndex: number | null }
  /** Fill every card-less face-down slot; index i is hand i's 5th card. */
  | { type: "REVEAL_FACE_DOWN"; cards: Record<PlayerId, Card[]> }
  | { type: "ADVANCE_REVEAL" }
  | { type: "REMATCH"; dealer: PlayerId };
