/**
 * Checks the server match clock: one shared match, timeout catch-up, and a late draw.
 * Run with: npx tsx lib/game/verify-match-store.ts
 */

import assert from "node:assert/strict";

import { INITIAL_HAND_SIZE, TURN_LIMIT_MS } from "./gameState";
import { DECK_SIZE } from "./tiles";
import { MatchFlowError, beginMatch, drawMatchTile, endActiveMatch, readMatch } from "./match-store";
import { drainNormalWins } from "./player-stats";

const ANNA = { id: "anna", name: "Anna" };
const BARTEK = { id: "bartek", name: "Bartek" };
const NOW = 1_700_000_000_000;

let assertions = 0;

function expectEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.strictEqual(actual, expected, message);
}

function expectNotEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.notStrictEqual(actual, expected, message);
}

beginMatch([ANNA, BARTEK], NOW);
const opened = readMatch(ANNA.id, null, NOW + 1_000);
expectEqual(opened.phase, "playing", "confirming the pair starts a match");
expectEqual(opened.isYourTurn, true, "the host plays first");
expectEqual(opened.you?.handCount, INITIAL_HAND_SIZE, "the opening rack is still the dealt 14");
expectEqual(opened.opponent?.handCount, INITIAL_HAND_SIZE, "the opponent still has 14");
expectEqual(
  opened.drawPileCount,
  DECK_SIZE - INITIAL_HAND_SIZE * 2,
  "the pile is what remains after the deal",
);
expectEqual(opened.remainingMs, TURN_LIMIT_MS - 1_000, "the server clock reports the time left");
expectEqual(opened.notice, null, "a fresh turn has no timeout notice");
expectEqual(opened.turnExpiresAt, new Date(NOW + TURN_LIMIT_MS).toISOString(), "the deadline is 60 seconds after the start");

const replayed = readMatch(ANNA.id, [ANNA, BARTEK], NOW + 1_000);
expectEqual(replayed.gameId, opened.gameId, "reading a confirmed invite does not redeal the match");
expectEqual(replayed.revision, opened.revision, "an unchanged read keeps the revision");

beginMatch([ANNA, BARTEK], NOW + 5_000);
const stillOpen = readMatch(BARTEK.id, null, NOW + 1_000);
expectEqual(stillOpen.gameId, opened.gameId, "a second start leaves the live match in place");
expectEqual(stillOpen.isYourTurn, false, "the opponent is waiting");

let refused: unknown;
try {
  drawMatchTile(ANNA.id, NOW + TURN_LIMIT_MS);
} catch (error) {
  refused = error;
}

assert.ok(refused instanceof MatchFlowError, "a draw on the deadline is refused");
const timeout = refused as MatchFlowError;
expectEqual(timeout.statusCode, 409, "a missed deadline answers with a conflict");
expectEqual(timeout.snapshot?.isYourTurn, false, "Anna is no longer the player to move");
expectEqual(timeout.snapshot?.you?.handCount, INITIAL_HAND_SIZE + 1, "the timeout drew one tile for Anna");
expectEqual(timeout.snapshot?.opponent?.handCount, INITIAL_HAND_SIZE, "Bartek has not drawn yet");
expectEqual(
  timeout.snapshot?.drawPileCount,
  DECK_SIZE - INITIAL_HAND_SIZE * 2 - 1,
  "the timeout removed one tile from the pile",
);
expectEqual(
  timeout.snapshot?.notice,
  "Czas tury minął. Układ wrócił do początku tury, dobrano 1 kafelek i kolejka przeszła dalej.",
  "the timeout explains the restore and the draw",
);
expectEqual(
  timeout.snapshot?.turnExpiresAt,
  new Date(NOW + TURN_LIMIT_MS * 2).toISOString(),
  "Bartek's turn expires one window later",
);

const caughtUp = readMatch(ANNA.id, null, NOW + TURN_LIMIT_MS);
expectEqual(caughtUp.you?.handCount, INITIAL_HAND_SIZE + 1, "a second read does not draw again");
expectEqual(caughtUp.revision, timeout.snapshot?.revision, "a settled timeout keeps its revision");

let late: unknown;
try {
  drawMatchTile(ANNA.id, NOW + TURN_LIMIT_MS + 1_000);
} catch (error) {
  late = error;
}

assert.ok(late instanceof MatchFlowError, "the previous player cannot draw after the timeout");
expectEqual(
  (late as MatchFlowError).message,
  "Teraz jest tura drugiego gracza.",
  "a late draw tells the player the turn has moved",
);
expectEqual(
  (late as MatchFlowError).snapshot?.you?.handCount,
  INITIAL_HAND_SIZE + 1,
  "the refused draw does not take another tile",
);

const skipped = readMatch(BARTEK.id, null, NOW + TURN_LIMIT_MS * 2);
expectEqual(skipped.isYourTurn, false, "two missed windows return the turn to Anna");
expectEqual(skipped.you?.handCount, INITIAL_HAND_SIZE + 1, "Bartek drew when his own window closed");
expectEqual(skipped.opponent?.handCount, INITIAL_HAND_SIZE + 1, "Anna kept the tile from the first timeout");
expectEqual(
  skipped.drawPileCount,
  DECK_SIZE - INITIAL_HAND_SIZE * 2 - 2,
  "each missed window draws one tile",
);
expectEqual(
  skipped.turnExpiresAt,
  new Date(NOW + TURN_LIMIT_MS * 3).toISOString(),
  "the live deadline is the third window",
);
expectEqual(
  skipped.notice,
  "Czas tury minął. Układ wrócił do początku tury, dobrano 1 kafelek i kolejka przeszła dalej.",
  "a later poll describes only the window it closed",
);

const drawn = drawMatchTile(ANNA.id, NOW + TURN_LIMIT_MS * 2 + 5_000);
expectEqual(drawn.isYourTurn, false, "a chosen draw passes the turn");
expectEqual(drawn.you?.handCount, INITIAL_HAND_SIZE + 2, "a chosen draw adds one tile to the restored rack");
expectEqual(drawn.notice, null, "a chosen draw clears the timeout notice");
expectEqual(
  drawn.turnExpiresAt,
  new Date(NOW + TURN_LIMIT_MS * 2 + 5_000 + TURN_LIMIT_MS).toISOString(),
  "a chosen draw starts a fresh 60 second turn",
);

const caughtUpTwice = readMatch(
  ANNA.id,
  null,
  NOW + TURN_LIMIT_MS * 2 + 5_000 + TURN_LIMIT_MS * 2,
);
expectEqual(
  caughtUpTwice.notice,
  "Minął limit czasu więcej niż jednej tury. Niezakończone ruchy wróciły do początku każdej z nich, a brakujące kafelki zostały dobrane, jeśli stos nie był pusty.",
  "one poll closes every window the disconnect covered",
);
expectEqual(caughtUpTwice.isYourTurn, false, "two caught-up windows leave the opponent to move");
expectEqual(caughtUpTwice.you?.handCount, INITIAL_HAND_SIZE + 3, "Anna drew again when her caught-up window closed");
expectEqual(caughtUpTwice.opponent?.handCount, INITIAL_HAND_SIZE + 2, "Bartek drew when his caught-up window closed");

const closedAt = NOW + TURN_LIMIT_MS * 2 + 5_000 + TURN_LIMIT_MS * 2;
const aborted = endActiveMatch(BARTEK.id, "manual", closedAt);
expectEqual(aborted.phase, "aborted", "a manual end closes the match");
expectEqual(aborted.winnerId, null, "a manual end does not name a winner");
expectEqual(aborted.isYourTurn, false, "a closed match has no active turn");
expectEqual(aborted.turnExpiresAt, null, "a closed match stops the turn clock");
expectEqual(
  aborted.notice,
  "Zakończyłeś partię. Gra nie została zapisana.",
  "the player who ends the match is told it was not recorded",
);
expectEqual(aborted.you?.handCount, INITIAL_HAND_SIZE + 2, "ending the match does not draw a tile");

const seenByAnna = readMatch(ANNA.id, [ANNA, BARTEK], closedAt + TURN_LIMIT_MS * 5);
expectEqual(seenByAnna.gameId, aborted.gameId, "a confirmed invite does not restart an aborted match");
expectEqual(seenByAnna.phase, "aborted", "the other browser still sees the closed match");
expectEqual(seenByAnna.winnerId, null, "the other browser does not see a recorded win");
expectEqual(
  seenByAnna.notice,
  "Bartek zakończył partię. Gra nie została zapisana.",
  "the other player is told who ended the match",
);
expectEqual(seenByAnna.you?.handCount, INITIAL_HAND_SIZE + 3, "time after an abort does not draw more tiles");
expectEqual(seenByAnna.opponent?.handCount, INITIAL_HAND_SIZE + 2, "the other rack stays where the abort left it");

let drawAfterAbort: unknown;
try {
  drawMatchTile(ANNA.id, closedAt + 1_000);
} catch (error) {
  drawAfterAbort = error;
}
assert.ok(drawAfterAbort instanceof MatchFlowError, "a draw after an abort is refused");
expectEqual(
  (drawAfterAbort as MatchFlowError).message,
  "Ta partia została przerwana.",
  "a draw after an abort explains that the match was closed",
);

const repeated = endActiveMatch(ANNA.id, "manual", closedAt + 2_000);
expectEqual(
  repeated.notice,
  "Bartek zakończył partię. Gra nie została zapisana.",
  "a second end keeps the original reason",
);

const stranger = endActiveMatch("nikt", "logout", closedAt + 3_000);
expectEqual(stranger.phase, "idle", "a logout from outside the match does not invent a seat");
expectEqual(
  readMatch(ANNA.id, null, closedAt + 3_000).phase,
  "aborted",
  "an outside logout leaves the closed match in place",
);

beginMatch([ANNA, BARTEK], closedAt + 10_000);
const restarted = readMatch(ANNA.id, null, closedAt + 10_000);
expectEqual(restarted.phase, "playing", "a new confirmation can start after an abort");
expectNotEqual(restarted.gameId, aborted.gameId, "the new match is a different game");
expectEqual(restarted.notice, null, "a new match does not keep the abort message");
expectEqual(restarted.winnerId, null, "a new match has no winner");

const left = endActiveMatch(ANNA.id, "logout", closedAt + 11_000);
expectEqual(left.phase, "aborted", "logout closes the playing match");
expectEqual(left.winnerId, null, "logout does not record a winner");
expectEqual(
  left.notice,
  "Wylogowałeś się. Partia została przerwana i nie została zapisana.",
  "the player who logs out is told the match was not recorded",
);
const waiting = readMatch(BARTEK.id, null, closedAt + TURN_LIMIT_MS * 4);
expectEqual(waiting.phase, "aborted", "the opponent still sees the match after the logout");
expectEqual(
  waiting.notice,
  "Anna wylogował się. Partia została przerwana i nie została zapisana.",
  "the opponent is told the logout ended the match",
);
expectEqual(waiting.you?.handCount, INITIAL_HAND_SIZE, "logout does not draw for the player who stays");
expectEqual(waiting.turnExpiresAt, null, "logout stops the turn clock for the other browser");

const MARTA = { id: "marta", name: "Marta" };
const KUBA = { id: "kuba", name: "Kuba" };
beginMatch([MARTA, KUBA], closedAt + 20_000);
const martaEnded = endActiveMatch(MARTA.id, "manual", closedAt + 20_000);
expectEqual(
  martaEnded.notice,
  "Zakończyłaś partię. Gra nie została zapisana.",
  "Marta is told she ended the match in the feminine",
);
expectEqual(
  readMatch(KUBA.id, null, closedAt + 20_000).notice,
  "Marta zakończyła partię. Gra nie została zapisana.",
  "Kuba is told that Marta ended the match in the feminine",
);

beginMatch([MARTA, KUBA], closedAt + 30_000);
const kubaEnded = endActiveMatch(KUBA.id, "manual", closedAt + 30_000);
expectEqual(
  kubaEnded.notice,
  "Zakończyłeś partię. Gra nie została zapisana.",
  "Kuba is told he ended the match in the masculine",
);
expectEqual(
  readMatch(MARTA.id, null, closedAt + 30_000).notice,
  "Kuba zakończył partię. Gra nie została zapisana.",
  "Marta is told that Kuba ended the match in the masculine",
);

beginMatch([MARTA, KUBA], closedAt + 40_000);
expectEqual(
  endActiveMatch(MARTA.id, "logout", closedAt + 40_000).notice,
  "Wylogowałaś się. Partia została przerwana i nie została zapisana.",
  "Marta's logout uses the feminine",
);
expectEqual(
  readMatch(KUBA.id, null, closedAt + 40_000).notice,
  "Marta wylogowała się. Partia została przerwana i nie została zapisana.",
  "Kuba is told that Marta logged out in the feminine",
);

beginMatch([MARTA, KUBA], closedAt + 50_000);
expectEqual(
  endActiveMatch(KUBA.id, "logout", closedAt + 50_000).notice,
  "Wylogowałeś się. Partia została przerwana i nie została zapisana.",
  "Kuba's logout uses the masculine",
);
expectEqual(
  readMatch(MARTA.id, null, closedAt + 50_000).notice,
  "Kuba wylogował się. Partia została przerwana i nie została zapisana.",
  "Marta is told that Kuba logged out in the masculine",
);

expectEqual(
  drainNormalWins().length,
  0,
  "aborts and logouts do not queue a stat update",
);

console.log(`Rummikub match store verification passed (${assertions} assertions).`);
