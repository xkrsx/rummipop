/**
 * Checks the five player statistics and the one-time normal-win queue.
 * Run with: npx tsx lib/game/verify-player-stats.ts
 */

import assert from "node:assert/strict";

import {
  applyMatchToPlayerStats,
  drainNormalWins,
  emptyPlayerStats,
  queueNormalWin,
  requeueNormalWins,
  type NormalWinCandidate,
} from "./player-stats";

let assertions = 0;

function expectEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.strictEqual(actual, expected, message);
}

function expectDeepEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, message);
}

function candidate(gameId: string, overrides: Partial<NormalWinCandidate> = {}): NormalWinCandidate {
  return {
    gameId,
    closedWithoutResult: false,
    status: "finished",
    winnerId: "anna",
    players: [
      { id: "anna", turnsTaken: 4 },
      { id: "bartek", turnsTaken: 3 },
    ],
    ...overrides,
  };
}

const firstWin = applyMatchToPlayerStats(emptyPlayerStats(), {
  won: true,
  winningTurnCount: 6,
});
expectEqual(firstWin.gamesPlayed, 1, "a win counts as a played match");
expectEqual(firstWin.wins, 1, "a win increments the win count");
expectEqual(firstWin.currentWinStreak, 1, "the first win starts the current streak");
expectEqual(firstWin.longestWinStreak, 1, "the first win starts the longest streak");
expectEqual(firstWin.fastestWin, 6, "the first win records its turn count");

const secondWin = applyMatchToPlayerStats(firstWin, {
  won: true,
  winningTurnCount: 4,
});
expectEqual(secondWin.wins, 2, "a second win adds another win");
expectEqual(secondWin.currentWinStreak, 2, "consecutive wins extend the current streak");
expectEqual(secondWin.longestWinStreak, 2, "the longest streak follows the current streak");
expectEqual(secondWin.fastestWin, 4, "a quicker win replaces the fastest turn count");

const slowerWin = applyMatchToPlayerStats(secondWin, {
  won: true,
  winningTurnCount: 9,
});
expectEqual(slowerWin.fastestWin, 4, "a slower win keeps the fastest turn count");
expectEqual(slowerWin.longestWinStreak, 3, "three wins in a row set the longest streak");

const loss = applyMatchToPlayerStats(slowerWin, {
  won: false,
  winningTurnCount: 2,
});
expectEqual(loss.gamesPlayed, 4, "a loss still counts as a played match");
expectEqual(loss.wins, 3, "a loss does not add a win");
expectEqual(loss.currentWinStreak, 0, "a loss clears the current streak");
expectEqual(loss.longestWinStreak, 3, "a loss keeps the longest streak");
expectEqual(loss.fastestWin, 4, "a loss keeps the fastest win");

const rebuilt = applyMatchToPlayerStats(loss, {
  won: true,
  winningTurnCount: 8,
});
expectEqual(rebuilt.currentWinStreak, 1, "a win after a loss starts a new streak");
expectEqual(rebuilt.longestWinStreak, 3, "a shorter new streak does not replace the longest one");

queueNormalWin(candidate("aborted", { closedWithoutResult: true }));
queueNormalWin(candidate("logout", { closedWithoutResult: true, winnerId: "bartek" }));
queueNormalWin(candidate("playing", { status: "playing" }));
queueNormalWin(candidate("no-winner", { winnerId: null }));
queueNormalWin(candidate("zero-turns", { players: [{ id: "anna", turnsTaken: 0 }, { id: "bartek", turnsTaken: 1 }] }));
expectEqual(drainNormalWins().length, 0, "aborts, logouts, and unfinished matches queue nothing");

queueNormalWin(candidate("game-1"));
queueNormalWin(candidate("game-1"));
const queued = drainNormalWins();
expectEqual(queued.length, 1, "the same finished match is queued once");
expectEqual(queued[0]?.winnerId, "anna", "the winner is the player named by the match");
expectEqual(queued[0]?.loserId, "bartek", "the other seat is the loser");
expectEqual(queued[0]?.winningTurnCount, 4, "the queued win keeps the winner's turn count");
queueNormalWin(candidate("game-1"));
expectEqual(drainNormalWins().length, 0, "a drained match is not queued again");

requeueNormalWins(queued);
queueNormalWin(candidate("game-1"));
const retried = drainNormalWins();
expectEqual(retried.length, 1, "a failed write can be queued again without a duplicate");
expectDeepEqual(retried[0], queued[0], "the retried win is the same match");

console.log(`Player stats verification passed (${assertions} assertions).`);
