/** Public match fields for one signed-in player. Hidden racks and the pile order stay on the server. */

export const MATCH_PHASES = ["idle", "playing", "finished", "aborted"] as const;

export type MatchPhase = (typeof MATCH_PHASES)[number];

export interface MatchSeatView {
  id: string;
  name: string;
  handCount: number;
}

/**
 * Match as seen by one player.
 * `remainingMs` is computed on the server from `turnExpiresAt`.
 */
export interface MatchSnapshot {
  /** Increases when the match changes so clients can ignore stale polls. */
  revision: number;
  phase: MatchPhase;
  serverNow: string;
  gameId: string | null;
  you: MatchSeatView | null;
  opponent: MatchSeatView | null;
  currentPlayerId: string | null;
  isYourTurn: boolean;
  /** ISO deadline for the active turn. Null when nobody is on the clock. */
  turnExpiresAt: string | null;
  remainingMs: number;
  drawPileCount: number;
  winnerId: string | null;
  /**
   * Polish explanation of the latest timeout, or of a manual end / logout.
   * Kept until the next match.
   */
  notice: string | null;
}
