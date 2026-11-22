/**
 * Standalone checks for the two-player Rummikub match and turn engine.
 * Run with: npx tsx lib/game/verify-engine.ts && npx tsx lib/game/verify-game-state.ts
 */

import assert from "node:assert/strict";

import {
  GameRuleError,
  INITIAL_HAND_SIZE,
  commitTurn,
  createTwoPlayerGame,
  drawTileAndEndTurn,
  resetTurn,
  type GameState,
  type GameStatus,
  type MatchPlayer,
  type TurnStartSnapshot,
} from "./gameState";
import { calculateSetPoints } from "./rules";
import {
  DECK_SIZE,
  createDeck,
  shuffleDeck,
  type Tile,
  type TileColor,
  type TileNumber,
  type TileSet,
} from "./tiles";

let assertions = 0;

function expectEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.strictEqual(actual, expected, message);
}

function expectDeepEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, message);
}

function expectNotEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.notStrictEqual(actual, expected, message);
}

function expectRule(run: () => void, message: string): void {
  assertions += 1;
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof GameRuleError, "expected a game rule error");
    assert.strictEqual(error.message, message);
    return true;
  });
}

function numbered(id: string, color: TileColor, number: TileNumber): Tile {
  return { id, color, number, isJoker: false };
}

function joker(id: string): Tile {
  return { id, color: null, number: null, isJoker: true };
}

function setOf(id: string, tiles: readonly Tile[]): TileSet {
  return { id, tiles: [...tiles] };
}

const ANNA = { id: "anna", name: "Anna" };
const BARTEK = { id: "bartek", name: "Bartek" };

const RED_1 = numbered("red-1-1", "red", 1);
const RED_2 = numbered("red-2-1", "red", 2);
const RED_3 = numbered("red-3-1", "red", 3);
const RED_4 = numbered("red-4-1", "red", 4);
const RED_5 = numbered("red-5-1", "red", 5);
const RED_6 = numbered("red-6-1", "red", 6);
const RED_7 = numbered("red-7-1", "red", 7);
const BLUE_1 = numbered("blue-1-1", "blue", 1);
const BLUE_5 = numbered("blue-5-1", "blue", 5);
const BLUE_7 = numbered("blue-7-1", "blue", 7);
const BLUE_8 = numbered("blue-8-1", "blue", 8);
const BLUE_9 = numbered("blue-9-1", "blue", 9);
const BLUE_10 = numbered("blue-10-1", "blue", 10);
const BLUE_10_COPY = numbered("blue-10-2", "blue", 10);
const YELLOW_1 = numbered("yellow-1-1", "yellow", 1);
const YELLOW_4 = numbered("yellow-4-1", "yellow", 4);
const YELLOW_5 = numbered("yellow-5-1", "yellow", 5);
const YELLOW_6 = numbered("yellow-6-1", "yellow", 6);
const YELLOW_10 = numbered("yellow-10-1", "yellow", 10);
const BLACK_1 = numbered("black-1-1", "black", 1);
const BLACK_2 = numbered("black-2-1", "black", 2);
const BLACK_5 = numbered("black-5-1", "black", 5);
const BLACK_7 = numbered("black-7-1", "black", 7);
const BLACK_10 = numbered("black-10-1", "black", 10);
const RED_5_COPY = numbered("red-5-2", "red", 5);
const RED_10 = numbered("red-10-1", "red", 10);
const RED_10_COPY = numbered("red-10-2", "red", 10);
const BLUE_2 = numbered("blue-2-1", "blue", 2);
const BLUE_3 = numbered("blue-3-1", "blue", 3);

const THREE_TENS = [RED_10, BLUE_10, BLACK_10];
const LOW_RUN = [BLUE_8, BLUE_9, BLUE_10_COPY];
const THREE_SEVENS = [RED_7, BLUE_7, BLACK_7];
const SHORT_RUN = [RED_1, RED_2, RED_3];

function makeState(input: {
  hands: readonly [readonly Tile[], readonly Tile[]];
  board?: readonly TileSet[];
  drawPile?: readonly Tile[];
  currentPlayerIndex?: 0 | 1;
  hasInitialMeld?: readonly [boolean, boolean];
  scores?: readonly [number, number];
  snapshot?: TurnStartSnapshot | null;
  status?: GameStatus;
  winnerId?: string | null;
}): GameState {
  const index = input.currentPlayerIndex ?? 0;
  const board = (input.board ?? []).map((set) => setOf(set.id, set.tiles));
  const hands: [Tile[], Tile[]] = [
    [...input.hands[0]],
    [...input.hands[1]],
  ];
  const snapshot =
    input.snapshot === undefined
      ? { board: board.map((set) => setOf(set.id, set.tiles)), hand: [...hands[index]] }
      : input.snapshot;

  return {
    id: "game-test",
    status: input.status ?? "playing",
    players: [
      {
        id: ANNA.id,
        name: ANNA.name,
        hand: hands[0],
        hasInitialMeld: input.hasInitialMeld?.[0] ?? false,
        score: input.scores?.[0] ?? 0,
      },
      {
        id: BARTEK.id,
        name: BARTEK.name,
        hand: hands[1],
        hasInitialMeld: input.hasInitialMeld?.[1] ?? false,
        score: input.scores?.[1] ?? 0,
      },
    ],
    currentPlayerIndex: index,
    drawPile: [...(input.drawPile ?? [])],
    board,
    turnStartSnapshot: snapshot,
    winnerId: input.winnerId ?? null,
  };
}

function commitPure(
  state: GameState,
  proposedBoard: TileSet[],
  remainingHand: Tile[],
): GameState {
  const before = structuredClone(state);
  const boardBefore = structuredClone(proposedBoard);
  const handBefore = structuredClone(remainingHand);
  const next = commitTurn(state, proposedBoard, remainingHand);
  expectDeepEqual(state, before, "commitTurn leaves the previous state unchanged");
  expectDeepEqual(proposedBoard, boardBefore, "commitTurn leaves the proposed board unchanged");
  expectDeepEqual(remainingHand, handBefore, "commitTurn leaves the remaining rack unchanged");
  expectNotEqual(next, state, "commitTurn returns a new state object");
  return next;
}

function expectRejected(
  state: GameState,
  proposedBoard: TileSet[],
  remainingHand: Tile[],
  message: string,
): void {
  const before = structuredClone(state);
  const boardBefore = structuredClone(proposedBoard);
  const handBefore = structuredClone(remainingHand);
  expectRule(() => commitTurn(state, proposedBoard, remainingHand), message);
  expectDeepEqual(state, before, "a rejected commit leaves the match unchanged");
  expectDeepEqual(proposedBoard, boardBefore, "a rejected commit leaves the proposal unchanged");
  expectDeepEqual(remainingHand, handBefore, "a rejected commit leaves the rack argument unchanged");
}

function verifySetup(): void {
  const seats: [MatchPlayer, MatchPlayer] = [
    { id: "lukasz", name: "Łukasz" },
    { id: "zofia", name: "Zofia" },
  ];
  const seatsBefore = structuredClone(seats);
  const game = createTwoPlayerGame(seats, () => 0);
  const dealt = shuffleDeck(createDeck(), () => 0);

  expectDeepEqual(seats, seatsBefore, "createTwoPlayerGame does not mutate the seat list");
  expectEqual(game.status, "playing", "a dealt match is already playing");
  expectEqual(game.currentPlayerIndex, 0, "the first seat plays first");
  expectEqual(game.winnerId, null, "a new match has no winner");
  expectEqual(game.board.length, 0, "a new match starts with an empty table");
  expectEqual(game.players[0].id, "lukasz", "the first seat keeps its id");
  expectEqual(game.players[0].name, "Łukasz", "the first seat keeps its name");
  expectEqual(game.players[1].id, "zofia", "the second seat keeps its id");
  expectEqual(game.players[1].name, "Zofia", "the second seat keeps its name");
  expectEqual(game.players[0].hasInitialMeld, false, "the first player has not opened");
  expectEqual(game.players[1].hasInitialMeld, false, "the second player has not opened");
  expectEqual(game.players[0].score, 0, "the first player starts at score 0");
  expectEqual(game.players[1].score, 0, "the second player starts at score 0");
  expectEqual(game.players[0].hand.length, INITIAL_HAND_SIZE, "the first player is dealt 14 tiles");
  expectEqual(game.players[1].hand.length, INITIAL_HAND_SIZE, "the second player is dealt 14 tiles");
  expectEqual(
    game.drawPile.length,
    DECK_SIZE - INITIAL_HAND_SIZE * 2,
    "the draw pile receives every tile that was not dealt",
  );
  expectDeepEqual(game.players[0].hand, dealt.slice(0, 14), "the first rack is the first 14 shuffled tiles");
  expectDeepEqual(
    game.players[1].hand,
    dealt.slice(14, 28),
    "the second rack is the next 14 shuffled tiles",
  );
  expectDeepEqual(game.drawPile, dealt.slice(28), "the draw pile preserves the rest of the shuffle");
  expectDeepEqual(
    game.turnStartSnapshot,
    { board: [], hand: game.players[0].hand },
    "the opening snapshot captures the empty table and the first rack",
  );
  expectNotEqual(
    game.turnStartSnapshot?.hand,
    game.players[0].hand,
    "the snapshot rack is a separate array from the live rack",
  );
  expectNotEqual(
    game.turnStartSnapshot?.hand[0],
    game.players[0].hand[0],
    "the snapshot copies each tile instead of sharing it",
  );

  const dealtIds = [
    ...game.players[0].hand,
    ...game.players[1].hand,
    ...game.drawPile,
  ].map((tile) => tile.id);
  const deckIds = createDeck().map((tile) => tile.id).sort();
  expectEqual(new Set(dealtIds).size, DECK_SIZE, "a dealt match has no duplicate tile ids");
  expectDeepEqual([...dealtIds].sort(), deckIds, "a dealt match contains the full 106-tile deck");

  const snapshotColor = game.turnStartSnapshot?.hand[0]?.color;
  game.players[0].hand[0].color = snapshotColor === "red" ? "blue" : "red";
  game.players[0].hand.pop();
  expectEqual(
    game.turnStartSnapshot?.hand[0]?.color,
    snapshotColor,
    "editing the live rack does not change the snapshot tile",
  );
  expectEqual(
    game.turnStartSnapshot?.hand.length,
    INITIAL_HAND_SIZE,
    "removing a live tile does not change the snapshot rack",
  );

  const again = createTwoPlayerGame(seats, () => 0);
  expectDeepEqual(again.players[0].hand, game.turnStartSnapshot?.hand, "the same shuffle deals the same first rack");
  expectNotEqual(again.id, game.id, "each match gets its own id");
  expectEqual(again.id.startsWith("game-"), true, "a match id is marked as a game");

  expectRule(
    () =>
      createTwoPlayerGame(
        [{ id: "only", name: "Only" }] as unknown as readonly [MatchPlayer, MatchPlayer],
      ),
    "Gra wymaga dokładnie dwóch graczy.",
  );
  expectRule(
    () =>
      createTwoPlayerGame([
        { id: "ada", name: "Ada" },
        { id: "ada", name: "Ada" },
      ]),
    "Gracze muszą mieć różne identyfikatory.",
  );
  expectRule(
    () =>
      createTwoPlayerGame([
        { id: "   ", name: "Ada" },
        { id: "bartek", name: "Bartek" },
      ]),
    "Identyfikator gracza nie może być pusty.",
  );
}

function verifyInitialMeld(): void {
  const kept = [RED_1];
  const below = makeState({
    hands: [[...LOW_RUN, ...kept], [YELLOW_1]],
    scores: [4, 6],
  });
  expectEqual(calculateSetPoints(LOW_RUN), 27, "the sample run is worth 27 points");
  expectRejected(
    below,
    [setOf("low-run", LOW_RUN)],
    kept,
    "Pierwsze wyłożenie musi tworzyć własne zestawy warte co najmniej 30 punktów.",
  );
  expectEqual(below.players[0].hasInitialMeld, false, "a rejected opening does not mark the meld");

  const exact = makeState({
    hands: [[...THREE_TENS, ...kept], [YELLOW_1]],
    drawPile: [BLACK_1],
    scores: [4, 6],
  });
  expectEqual(calculateSetPoints(THREE_TENS), 30, "three 10s are worth exactly 30 points");
  const opened = commitPure(exact, [setOf("tens", THREE_TENS)], kept);
  expectEqual(opened.status, "playing", "an opening meld continues the match");
  expectEqual(opened.currentPlayerIndex, 1, "an opening meld passes the turn");
  expectEqual(opened.winnerId, null, "an opening meld has no winner");
  expectEqual(opened.players[0].hasInitialMeld, true, "the opener is marked as having melded");
  expectEqual(opened.players[1].hasInitialMeld, false, "the waiting player still has to open");
  expectDeepEqual(opened.players[0].hand, kept, "the opener keeps the tiles left on the rack");
  expectEqual(opened.players[0].score, 4, "an opening meld keeps the opener's score");
  expectDeepEqual(opened.players[1], exact.players[1], "the waiting player is unchanged by the opening");
  expectDeepEqual(opened.board, [setOf("tens", THREE_TENS)], "the opening set is now on the table");
  expectDeepEqual(opened.drawPile, [BLACK_1], "an opening meld does not draw");
  expectDeepEqual(
    opened.turnStartSnapshot,
    { board: [setOf("tens", THREE_TENS)], hand: [YELLOW_1] },
    "the next snapshot is the new table and the second player's rack",
  );
  expectNotEqual(
    opened.turnStartSnapshot?.board,
    opened.board,
    "the next snapshot copies the table",
  );

  const splitSets = [
    setOf("run", [RED_4, RED_5, RED_6]),
    setOf("group", [RED_5_COPY, YELLOW_5, BLACK_5]),
  ];
  const splitHand = [...splitSets[0].tiles, ...splitSets[1].tiles, BLUE_1];
  const splitState = makeState({
    hands: [splitHand, [YELLOW_1]],
  });
  expectEqual(
    calculateSetPoints(splitSets[0].tiles) + calculateSetPoints(splitSets[1].tiles),
    30,
    "a 15-point run plus a 15-point group is an opening meld",
  );
  const splitNext = commitPure(splitState, splitSets, [BLUE_1]);
  expectEqual(splitNext.players[0].hasInitialMeld, true, "split sets of 30 points open the player");
  expectDeepEqual(splitNext.board, splitSets, "both opening sets stay on the table");
  expectEqual(splitNext.currentPlayerIndex, 1, "a split opening passes the turn");

  const jokerOpen = [joker("joker-1"), joker("joker-2"), RED_10];
  expectEqual(
    calculateSetPoints(jokerOpen),
    30,
    "two jokers with a 10 are worth 30 as a group",
  );
  const jokerState = makeState({
    hands: [[...jokerOpen, BLUE_1], [YELLOW_1]],
  });
  const jokerNext = commitPure(jokerState, [setOf("joker-tens", jokerOpen)], [BLUE_1]);
  expectEqual(jokerNext.players[0].hasInitialMeld, true, "a 30-point joker group opens the player");

  const jokerShort = [joker("joker-1"), joker("joker-2"), numbered("red-9-1", "red", 9)];
  expectEqual(calculateSetPoints(jokerShort), 27, "two jokers with a 9 are worth 27");
  expectRejected(
    makeState({ hands: [jokerShort, [YELLOW_1]] }),
    [setOf("joker-nines", jokerShort)],
    [],
    "Pierwsze wyłożenie musi tworzyć własne zestawy warte co najmniej 30 punktów.",
  );

  const secondSeat = makeState({
    hands: [[RED_1], [BLUE_1, BLUE_2, BLUE_3, YELLOW_1]],
    board: [setOf("tens", THREE_TENS)],
    currentPlayerIndex: 1,
    hasInitialMeld: [true, false],
  });
  expectRejected(
    secondSeat,
    [setOf("tens", THREE_TENS), setOf("low", [BLUE_1, BLUE_2, BLUE_3])],
    [YELLOW_1],
    "Pierwsze wyłożenie musi tworzyć własne zestawy warte co najmniej 30 punktów.",
  );

  const extending = makeState({
    hands: [[RED_1], [YELLOW_10, BLUE_1]],
    board: [setOf("tens", THREE_TENS)],
    currentPlayerIndex: 1,
    hasInitialMeld: [true, false],
  });
  expectRejected(
    extending,
    [setOf("extended", [...THREE_TENS, YELLOW_10])],
    [BLUE_1],
    "Pierwsze wyłożenie musi tworzyć własne zestawy warte co najmniej 30 punktów.",
  );

  const secondOpen = makeState({
    hands: [[RED_1], [RED_10_COPY, BLUE_10_COPY, YELLOW_10, YELLOW_1]],
    board: [setOf("tens", THREE_TENS)],
    currentPlayerIndex: 1,
    hasInitialMeld: [true, false],
    scores: [2, 8],
  });
  const secondSets = [
    setOf("tens", THREE_TENS),
    setOf("more-tens", [RED_10_COPY, BLUE_10_COPY, YELLOW_10]),
  ];
  const secondNext = commitPure(secondOpen, secondSets, [YELLOW_1]);
  expectEqual(secondNext.players[1].hasInitialMeld, true, "the second player opens on their own 30 points");
  expectEqual(secondNext.players[0].hasInitialMeld, true, "the first player's meld stays in place");
  expectEqual(secondNext.currentPlayerIndex, 0, "the turn returns to the first player");
  expectEqual(secondNext.players[1].score, 8, "the second player's score stays unchanged");
  expectDeepEqual(secondNext.players[1].hand, [YELLOW_1], "the second player keeps the unused tile");
  expectDeepEqual(secondNext.players[0].hand, [RED_1], "the waiting rack is unchanged");
}

function verifyCommit(): void {
  const state = makeState({
    hands: [[...LOW_RUN, RED_1], [YELLOW_1]],
    hasInitialMeld: [true, false],
    scores: [2, 8],
    drawPile: [BLACK_1, BLACK_2],
  });
  const next = commitPure(state, [setOf("low-run", LOW_RUN)], [RED_1]);
  expectEqual(next.status, "playing", "a legal play continues the match");
  expectEqual(next.currentPlayerIndex, 1, "a legal play passes the turn");
  expectEqual(next.players[0].hasInitialMeld, true, "a later play keeps the opening meld");
  expectEqual(next.players[0].score, 2, "a later play keeps the score");
  expectEqual(next.players[1].score, 8, "a later play keeps the opponent's score");
  expectDeepEqual(next.players[0].hand, [RED_1], "played tiles leave the rack");
  expectDeepEqual(next.players[1].hand, [YELLOW_1], "the opponent's rack stays in place");
  expectDeepEqual(next.board, [setOf("low-run", LOW_RUN)], "the played run is on the table");
  expectDeepEqual(next.drawPile, [BLACK_1, BLACK_2], "a committed play does not draw");
  expectDeepEqual(
    next.turnStartSnapshot,
    { board: [setOf("low-run", LOW_RUN)], hand: [YELLOW_1] },
    "the snapshot follows the player who is now on turn",
  );

  const table = makeState({
    hands: [[YELLOW_10, RED_1], [YELLOW_1]],
    board: [setOf("tens", THREE_TENS)],
    hasInitialMeld: [true, true],
  });
  const extended = commitPure(
    table,
    [setOf("tens", [...THREE_TENS, YELLOW_10])],
    [RED_1],
  );
  expectDeepEqual(
    extended.board[0]?.tiles.map((tile) => tile.id),
    [...THREE_TENS, YELLOW_10].map((tile) => tile.id),
    "after the opening meld a player may add a tile to an existing set",
  );
  expectEqual(extended.currentPlayerIndex, 1, "extending a set passes the turn");

  const arranged = makeState({
    hands: [[RED_4, BLUE_1], [YELLOW_1]],
    board: [setOf("sevens", THREE_SEVENS), setOf("run", SHORT_RUN)],
    hasInitialMeld: [true, true],
  });
  const rearranged = commitPure(
    arranged,
    [
      setOf("run", [...SHORT_RUN, RED_4]),
      setOf("sevens", [BLACK_7, RED_7, BLUE_7]),
    ],
    [BLUE_1],
  );
  const keptIds = rearranged.board.flatMap((set) => set.tiles.map((tile) => tile.id)).sort();
  const previousIds = [...THREE_SEVENS, ...SHORT_RUN, RED_4].map((tile) => tile.id).sort();
  expectDeepEqual(keptIds, previousIds, "rearranging the table keeps every tile that was already down");
  expectDeepEqual(rearranged.players[0].hand, [BLUE_1], "the tile that was not played stays on the rack");

  const sameTable = makeState({
    hands: [[RED_1], [YELLOW_1]],
    board: [setOf("sevens", THREE_SEVENS)],
    hasInitialMeld: [true, true],
  });
  expectRejected(
    sameTable,
    [setOf("sevens", [BLACK_7, BLUE_7, RED_7])],
    [RED_1],
    "Musisz wyłożyć co najmniej jeden kafelek ze swojej ręki.",
  );

  const dropping = makeState({
    hands: [SHORT_RUN, [YELLOW_1]],
    board: [setOf("sevens", THREE_SEVENS), setOf("tens", THREE_TENS)],
    hasInitialMeld: [true, true],
  });
  expectRejected(
    dropping,
    [setOf("sevens", THREE_SEVENS), setOf("run", SHORT_RUN)],
    [],
    "Nie można usunąć kafelków ze stołu.",
  );

  const foreign = makeState({
    hands: [[RED_1, RED_2], [RED_3]],
    hasInitialMeld: [true, true],
  });
  expectRejected(
    foreign,
    [setOf("run", SHORT_RUN)],
    [],
    "Ruch zawiera kafelek, który nie pochodzi z ręki ani ze stołu.",
  );

  const disguised = numbered("red-4-1", "red", 7);
  const changed = makeState({
    hands: [[RED_4, RED_5, RED_6], [YELLOW_1]],
    hasInitialMeld: [true, true],
  });
  expectRejected(
    changed,
    [setOf("run", [RED_5, RED_6, disguised])],
    [],
    "Kafelek w ruchu został zmieniony.",
  );

  const repeated = makeState({
    hands: [SHORT_RUN, [YELLOW_1]],
    hasInitialMeld: [true, true],
  });
  expectRejected(
    repeated,
    [setOf("first", SHORT_RUN), setOf("second", SHORT_RUN)],
    [],
    "Kafelki w ruchu powtarzają się.",
  );

  const mismatch = makeState({
    hands: [[...SHORT_RUN, BLUE_5], [YELLOW_1]],
    hasInitialMeld: [true, true],
  });
  expectRejected(
    mismatch,
    [setOf("run", SHORT_RUN)],
    [],
    "Pozostałe kafelki na ręce nie zgadzają się z tym ruchem.",
  );

  const gap = makeState({
    hands: [[RED_1, RED_2, RED_4], [YELLOW_1]],
    hasInitialMeld: [true, true],
  });
  expectRejected(
    gap,
    [setOf("gap", [RED_1, RED_2, RED_4])],
    [],
    "Proponowany układ na stole jest nieprawidłowy.",
  );
}

function verifyDraw(): void {
  const state = makeState({
    hands: [[RED_1], [YELLOW_1, YELLOW_4]],
    board: [setOf("sevens", THREE_SEVENS)],
    drawPile: [BLACK_1, BLACK_2],
    snapshot: { board: [], hand: [RED_1, RED_2] },
    hasInitialMeld: [false, false],
    scores: [3, 5],
  });
  const before = structuredClone(state);
  const next = drawTileAndEndTurn(state);

  expectDeepEqual(state, before, "drawTileAndEndTurn leaves the previous state unchanged");
  expectNotEqual(next, state, "drawTileAndEndTurn returns a new state object");
  expectEqual(next.status, "playing", "drawing leaves the match in play");
  expectEqual(next.currentPlayerIndex, 1, "drawing passes the turn");
  expectEqual(next.winnerId, null, "drawing does not declare a winner");
  expectEqual(next.players[0].hasInitialMeld, false, "drawing does not count as an opening meld");
  expectEqual(next.players[0].score, 3, "drawing keeps the active score");
  expectEqual(next.players[1].score, 5, "drawing keeps the opponent's score");
  expectDeepEqual(next.board, [], "drawing restores the table from the start of the turn");
  expectDeepEqual(
    next.players[0].hand,
    [RED_1, RED_2, BLACK_1],
    "drawing restores the rack and appends the first tile of the pile",
  );
  expectDeepEqual(next.drawPile, [BLACK_2], "the drawn tile leaves the pile");
  expectDeepEqual(next.players[1].hand, [YELLOW_1, YELLOW_4], "the opponent's rack is not drawn into");
  expectDeepEqual(
    next.turnStartSnapshot,
    { board: [], hand: [YELLOW_1, YELLOW_4] },
    "the next snapshot belongs to the player now on turn",
  );
  expectNotEqual(
    next.players[0].hand[2],
    state.drawPile[0],
    "the drawn tile is a copy, not the pile's original object",
  );

  const passing = makeState({
    hands: [[YELLOW_1], [RED_1]],
    board: [setOf("sevens", THREE_SEVENS)],
    drawPile: [],
    snapshot: { board: [setOf("tens", THREE_TENS)], hand: [RED_1, RED_2] },
    currentPlayerIndex: 1,
  });
  const passed = drawTileAndEndTurn(passing);
  expectEqual(passed.currentPlayerIndex, 0, "an empty pile still passes the turn");
  expectDeepEqual(passed.drawPile, [], "an empty pile stays empty");
  expectDeepEqual(passed.players[1].hand, [RED_1, RED_2], "an empty pile restores the rack without a new tile");
  expectDeepEqual(
    passed.board,
    [setOf("tens", THREE_TENS)],
    "an empty pile restores the table before passing",
  );
  expectDeepEqual(passed.players[0].hand, [YELLOW_1], "passing does not change the other rack");
}

function verifyReset(): void {
  const state = makeState({
    hands: [[RED_1], [YELLOW_1, YELLOW_4]],
    board: [setOf("sevens", THREE_SEVENS)],
    drawPile: [BLACK_1],
    snapshot: { board: [setOf("tens", THREE_TENS)], hand: [RED_1, RED_2] },
    hasInitialMeld: [false, true],
    scores: [4, 9],
  });
  const before = structuredClone(state);
  const next = resetTurn(state);

  expectDeepEqual(state, before, "resetTurn leaves the previous state unchanged");
  expectNotEqual(next, state, "resetTurn returns a new state object");
  expectEqual(next.status, "playing", "resetting does not end the match");
  expectEqual(next.currentPlayerIndex, 0, "resetting keeps the same player on turn");
  expectEqual(next.winnerId, null, "resetting does not declare a winner");
  expectEqual(next.players[0].hasInitialMeld, false, "resetting does not grant the opening meld");
  expectEqual(next.players[1].hasInitialMeld, true, "resetting keeps the opponent's meld");
  expectEqual(next.players[0].score, 4, "resetting keeps the active score");
  expectEqual(next.players[1].score, 9, "resetting keeps the opponent's score");
  expectDeepEqual(next.board, [setOf("tens", THREE_TENS)], "resetting restores the table");
  expectDeepEqual(next.players[0].hand, [RED_1, RED_2], "resetting restores the active rack");
  expectDeepEqual(next.players[1].hand, [YELLOW_1, YELLOW_4], "resetting leaves the other rack in place");
  expectDeepEqual(next.drawPile, [BLACK_1], "resetting does not draw");
  expectDeepEqual(
    next.turnStartSnapshot,
    { board: [setOf("tens", THREE_TENS)], hand: [RED_1, RED_2] },
    "the restored turn still starts from the same snapshot",
  );
  expectNotEqual(next.board, next.turnStartSnapshot?.board, "the restored table is a new copy of the snapshot");
  expectNotEqual(next.players[0].hand, next.turnStartSnapshot?.hand, "the restored rack is a new copy of the snapshot");
}

function verifyResetThenPlay(): void {
  const restored = resetTurn(
    makeState({
      hands: [[RED_1], [YELLOW_1]],
      board: [setOf("sevens", THREE_SEVENS)],
      snapshot: { board: [], hand: [...THREE_TENS, RED_1] },
    }),
  );
  const next = commitPure(restored, [setOf("tens", THREE_TENS)], [RED_1]);
  expectEqual(next.players[0].hasInitialMeld, true, "a restored rack can still open");
  expectEqual(next.currentPlayerIndex, 1, "the play after a reset passes the turn");
  expectDeepEqual(next.board, [setOf("tens", THREE_TENS)], "the play after a reset uses the restored tiles");
}

function verifyWin(): void {
  const later = makeState({
    hands: [[RED_1], [YELLOW_4, YELLOW_5, YELLOW_6]],
    board: [setOf("tens", THREE_TENS)],
    drawPile: [BLACK_1],
    currentPlayerIndex: 1,
    hasInitialMeld: [true, true],
    scores: [1, 2],
  });
  const won = commitPure(
    later,
    [setOf("tens", THREE_TENS), setOf("run", [YELLOW_4, YELLOW_5, YELLOW_6])],
    [],
  );
  expectEqual(won.status, "finished", "an empty rack finishes the match");
  expectEqual(won.winnerId, BARTEK.id, "the player who empties the rack wins");
  expectEqual(won.currentPlayerIndex, 1, "the turn stays on the winner");
  expectEqual(won.players[1].hasInitialMeld, true, "the winner keeps the opening meld");
  expectDeepEqual(won.players[1].hand, [], "the winner's rack is empty");
  expectDeepEqual(won.players[0].hand, [RED_1], "the other rack stays in place");
  expectEqual(won.players[0].score, 1, "winning does not change the recorded scores");
  expectEqual(won.players[1].score, 2, "winning does not award a score by itself");
  expectDeepEqual(won.drawPile, [BLACK_1], "winning does not draw");
  expectDeepEqual(
    won.turnStartSnapshot,
    { board: [setOf("tens", THREE_TENS)], hand: [YELLOW_4, YELLOW_5, YELLOW_6] },
    "the finished match keeps the snapshot from the start of the winning turn",
  );

  const openingWin = makeState({
    hands: [THREE_TENS, [YELLOW_1]],
  });
  const openedAndWon = commitPure(openingWin, [setOf("tens", THREE_TENS)], []);
  expectEqual(openedAndWon.status, "finished", "going out on the opening meld finishes the match");
  expectEqual(openedAndWon.winnerId, ANNA.id, "the opener who goes out is the winner");
  expectEqual(openedAndWon.players[0].hasInitialMeld, true, "going out also completes the opening meld");
  expectEqual(openedAndWon.currentPlayerIndex, 0, "going out does not pass the turn");
  expectDeepEqual(openedAndWon.players[0].hand, [], "the opener's rack is empty");

  const tooSmall = makeState({
    hands: [LOW_RUN, [YELLOW_1]],
  });
  expectRejected(
    tooSmall,
    [setOf("low-run", LOW_RUN)],
    [],
    "Pierwsze wyłożenie musi tworzyć własne zestawy warte co najmniej 30 punktów.",
  );
  expectEqual(tooSmall.status, "playing", "a short final meld does not finish the match");
  expectEqual(tooSmall.winnerId, null, "a short final meld does not choose a winner");

  expectRule(() => commitTurn(won, won.board, []), "Ta gra nie jest w toku.");
  expectRule(() => drawTileAndEndTurn(won), "Ta gra nie jest w toku.");
  expectRule(() => resetTurn(won), "Ta gra nie jest w toku.");
  expectDeepEqual(won.board, [
    setOf("tens", THREE_TENS),
    setOf("run", [YELLOW_4, YELLOW_5, YELLOW_6]),
  ], "rejected actions after the win leave the winning table in place");
}

function verifyUnplayableState(): void {
  const waiting = makeState({
    hands: [[RED_1], [YELLOW_1]],
    status: "waiting",
  });
  expectRule(() => drawTileAndEndTurn(waiting), "Ta gra nie jest w toku.");
  expectRule(() => resetTurn(waiting), "Ta gra nie jest w toku.");

  const missing = makeState({
    hands: [[RED_1, RED_2, RED_3], [YELLOW_1]],
    snapshot: null,
    hasInitialMeld: [true, true],
  });
  expectRule(
    () => commitTurn(missing, [setOf("run", SHORT_RUN)], []),
    "Brak zapisanego stanu tury.",
  );
  expectRule(() => drawTileAndEndTurn(missing), "Brak zapisanego stanu tury.");
  expectRule(() => resetTurn(missing), "Brak zapisanego stanu tury.");

  const shared = RED_1;
  const inconsistent = makeState({
    hands: [[shared, RED_2], [YELLOW_1]],
    board: [setOf("run", [shared, numbered("red-2-2", "red", 2), RED_3])],
    hasInitialMeld: [true, true],
    snapshot: {
      board: [setOf("run", [shared, numbered("red-2-2", "red", 2), RED_3])],
      hand: [shared, RED_5, RED_6],
    },
  });
  expectRejected(
    inconsistent,
    [setOf("run", [RED_5, RED_6, numbered("red-7-2", "red", 7)])],
    [shared],
    "Zapisany stan tury jest niespójny.",
  );
}

verifySetup();
verifyInitialMeld();
verifyCommit();
verifyDraw();
verifyReset();
verifyResetThenPlay();
verifyWin();
verifyUnplayableState();

console.log(`Rummikub match state verification passed (${assertions} assertions).`);
