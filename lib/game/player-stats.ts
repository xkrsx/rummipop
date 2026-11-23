import type { GameStatus } from "@/lib/game/gameState";
import type { PlayerStats } from "@/types/database";

/** A normal finish that should change both players' records exactly once. */
export interface NormalWin {
  gameId: string;
  winnerId: string;
  loserId: string;
  /** Completed turns of the winner, including the winning play. */
  winningTurnCount: number;
}

export interface NormalWinCandidate {
  gameId: string;
  /** True when the match was aborted by hand or by logout. Those matches are ignored. */
  closedWithoutResult: boolean;
  status: GameStatus;
  winnerId: string | null;
  players: readonly { id: string; turnsTaken: number }[];
}

const recordedGameIds = new Set<string>();
const pendingWins: NormalWin[] = [];

export function emptyPlayerStats(): PlayerStats {
  return {
    gamesPlayed: 0,
    wins: 0,
    longestWinStreak: 0,
    currentWinStreak: 0,
    fastestWin: null,
  };
}

function fasterWin(current: number | null, turnCount: number): number | null {
  if (!Number.isInteger(turnCount) || turnCount < 1) {
    return current;
  }

  if (current === null) {
    return turnCount;
  }

  return Math.min(current, turnCount);
}

/**
 * Applies one finished match to a single player.
 * The loser plays one more game and their current streak returns to zero.
 * The winner adds a win, extends both streak counters, and keeps the lower turn count.
 */
export function applyMatchToPlayerStats(
  stats: PlayerStats,
  outcome: { won: boolean; winningTurnCount: number },
): PlayerStats {
  if (!outcome.won) {
    return {
      gamesPlayed: stats.gamesPlayed + 1,
      wins: stats.wins,
      longestWinStreak: stats.longestWinStreak,
      currentWinStreak: 0,
      fastestWin: stats.fastestWin,
    };
  }

  const currentWinStreak = stats.currentWinStreak + 1;

  return {
    gamesPlayed: stats.gamesPlayed + 1,
    wins: stats.wins + 1,
    longestWinStreak: Math.max(stats.longestWinStreak, currentWinStreak),
    currentWinStreak,
    fastestWin: fasterWin(stats.fastestWin, outcome.winningTurnCount),
  };
}

function isRecordableTurnCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

/**
 * Queues a stat update for a match that ended with a winner.
 * A manual abort, a logout, a match still in play, and a second look at the
 * same finished match do nothing.
 */
export function queueNormalWin(candidate: NormalWinCandidate): void {
  if (candidate.closedWithoutResult) {
    return;
  }

  if (candidate.status !== "finished" || candidate.winnerId === null) {
    return;
  }

  if (
    recordedGameIds.has(candidate.gameId) ||
    pendingWins.some((win) => win.gameId === candidate.gameId)
  ) {
    return;
  }

  const winner = candidate.players.find((player) => player.id === candidate.winnerId);
  const loser = candidate.players.find((player) => player.id !== candidate.winnerId);
  if (winner === undefined || loser === undefined || winner.id === loser.id) {
    return;
  }

  if (!isRecordableTurnCount(winner.turnsTaken)) {
    return;
  }

  recordedGameIds.add(candidate.gameId);
  pendingWins.push({
    gameId: candidate.gameId,
    winnerId: winner.id,
    loserId: loser.id,
    winningTurnCount: winner.turnsTaken,
  });
}

/** Removes every queued win so one writer can persist the batch. */
export function drainNormalWins(): NormalWin[] {
  return pendingWins.splice(0, pendingWins.length);
}

/** Puts wins that failed to persist back at the front of the queue. */
export function requeueNormalWins(wins: readonly NormalWin[]): void {
  for (let index = wins.length - 1; index >= 0; index -= 1) {
    const win = wins[index];
    if (win === undefined) {
      continue;
    }

    recordedGameIds.add(win.gameId);
    if (!pendingWins.some((queued) => queued.gameId === win.gameId)) {
      pendingWins.unshift(win);
    }
  }
}
