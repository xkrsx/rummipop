/**
 * Standalone checks for the Rummikub deck and rules engine.
 * Run with: npx tsx lib/game/verify-engine.ts
 */

import assert from "node:assert/strict";

import {
  calculateSetPoints,
  validateBoard,
  validateSet,
} from "./rules";
import {
  DECK_SIZE,
  TILE_COLORS,
  createDeck,
  shuffleDeck,
  type Tile,
  type TileColor,
  type TileNumber,
} from "./tiles";

const INITIAL_MELD_THRESHOLD = 30;

let assertions = 0;

function expectEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.strictEqual(actual, expected, message);
}

function expectDeepEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, message);
}

function numberedTile(
  id: string,
  color: TileColor,
  number: TileNumber,
): Tile {
  return { id, color, number, isJoker: false };
}

function jokerTile(id: string): Tile {
  return { id, color: null, number: null, isJoker: true };
}

function expectValidSet(tiles: readonly Tile[], points: number, label: string): void {
  expectEqual(validateSet(tiles), true, `${label} is a valid set`);
  expectEqual(calculateSetPoints(tiles), points, `${label} is worth ${points} points`);
}

function expectInvalidSet(tiles: readonly Tile[], label: string): void {
  expectEqual(validateSet(tiles), false, `${label} is not a valid set`);
  expectEqual(calculateSetPoints(tiles), 0, `${label} scores 0 points`);
}

function verifyDeck(): void {
  const deck = createDeck();
  const ids = deck.map((tile) => tile.id);
  const numbered = deck.filter((tile) => !tile.isJoker);
  const jokers = deck.filter((tile) => tile.isJoker);

  expectEqual(deck.length, DECK_SIZE, "deck has 106 tiles");
  expectEqual(new Set(ids).size, DECK_SIZE, "every deck tile id is unique");
  expectEqual(numbered.length, 104, "deck has 104 numbered tiles");
  expectEqual(jokers.length, 2, "deck has 2 jokers");

  for (const color of TILE_COLORS) {
    for (let number = 1; number <= 13; number += 1) {
      const copies = numbered.filter(
        (tile) => tile.color === color && tile.number === number,
      );
      expectEqual(
        copies.length,
        2,
        `deck has two ${color} ${number}s`,
      );
      for (const tile of copies) {
        expectEqual(tile.isJoker, false, `${tile.id} is not a joker`);
      }
    }
  }

  expectDeepEqual(
    jokers.map((tile) => tile.id).sort(),
    ["joker-1", "joker-2"],
    "joker ids are joker-1 and joker-2",
  );
  for (const joker of jokers) {
    expectEqual(joker.color, null, `${joker.id} has no color`);
    expectEqual(joker.number, null, `${joker.id} has no number`);
    expectEqual(joker.isJoker, true, `${joker.id} is a joker`);
  }

  const first = createDeck();
  const order = first.map((tile) => tile.id);
  const shuffled = shuffleDeck(first, () => 0);
  shuffled.reverse();
  expectDeepEqual(
    first.map((tile) => tile.id),
    order,
    "shuffleDeck does not mutate the input deck",
  );
  expectEqual(shuffled.length, DECK_SIZE, "shuffled deck keeps every tile");
  expectDeepEqual(
    [...shuffled.map((tile) => tile.id)].sort(),
    [...order].sort(),
    "shuffled deck contains the same tile ids",
  );

  const left = shuffleDeck(first, () => 0).map((tile) => tile.id);
  const right = shuffleDeck(first, () => 0).map((tile) => tile.id);
  expectDeepEqual(left, right, "the same random source produces the same order");
  assert.notDeepStrictEqual(left, order, "a zero random source changes the deck order");
  assertions += 1;
}

function verifyGroups(): void {
  expectValidSet(
    [
      numberedTile("red-7-1", "red", 7),
      numberedTile("blue-7-1", "blue", 7),
      numberedTile("black-7-1", "black", 7),
    ],
    21,
    "group of three 7s",
  );

  expectValidSet(
    [
      numberedTile("red-7-1", "red", 7),
      numberedTile("blue-7-1", "blue", 7),
      numberedTile("yellow-7-1", "yellow", 7),
      numberedTile("black-7-1", "black", 7),
    ],
    28,
    "group of four 7s",
  );

  expectValidSet(
    [
      numberedTile("red-10-1", "red", 10),
      numberedTile("blue-10-1", "blue", 10),
      jokerTile("joker-1"),
    ],
    30,
    "group of 10s with one joker",
  );

  expectValidSet(
    [
      numberedTile("red-8-1", "red", 8),
      numberedTile("yellow-8-1", "yellow", 8),
      numberedTile("black-8-1", "black", 8),
      jokerTile("joker-1"),
    ],
    32,
    "group of 8s with one joker filling the fourth color",
  );

  expectValidSet(
    [
      numberedTile("red-9-1", "red", 9),
      numberedTile("blue-9-1", "blue", 9),
      jokerTile("joker-1"),
      jokerTile("joker-2"),
    ],
    36,
    "group of 9s with two jokers",
  );

  expectInvalidSet(
    [
      numberedTile("red-7-1", "red", 7),
      numberedTile("red-7-2", "red", 7),
      numberedTile("blue-7-1", "blue", 7),
    ],
    "group with two red 7s",
  );

  expectInvalidSet(
    [
      numberedTile("red-7-1", "red", 7),
      numberedTile("blue-7-1", "blue", 7),
    ],
    "group of only two tiles",
  );

  expectInvalidSet(
    [numberedTile("red-4-1", "red", 4)],
    "group of one tile",
  );

  expectInvalidSet([], "empty group");

  expectInvalidSet(
    [
      numberedTile("red-7-1", "red", 7),
      numberedTile("blue-7-1", "blue", 7),
      numberedTile("yellow-7-1", "yellow", 7),
      numberedTile("black-7-1", "black", 7),
      jokerTile("joker-1"),
    ],
    "group of more than four tiles",
  );

  expectInvalidSet(
    [
      numberedTile("red-7-1", "red", 7),
      numberedTile("blue-7-1", "blue", 7),
      numberedTile("black-8-1", "black", 8),
    ],
    "group whose numbers do not match",
  );

  expectInvalidSet(
    [jokerTile("joker-1"), jokerTile("joker-2"), jokerTile("joker-3")],
    "group made only of jokers",
  );

  expectInvalidSet(
    [
      numberedTile("same-id", "red", 7),
      numberedTile("same-id", "blue", 7),
      numberedTile("black-7-1", "black", 7),
    ],
    "group that repeats a tile id",
  );
}

function verifyRuns(): void {
  expectValidSet(
    [
      numberedTile("red-4-1", "red", 4),
      numberedTile("red-5-1", "red", 5),
      numberedTile("red-6-1", "red", 6),
    ],
    15,
    "run 4-5-6",
  );

  expectValidSet(
    [
      numberedTile("blue-1-1", "blue", 1),
      numberedTile("blue-2-1", "blue", 2),
      numberedTile("blue-3-1", "blue", 3),
    ],
    6,
    "run 1-2-3",
  );

  const fullRun = Array.from({ length: 13 }, (_, index) => {
    const number = (index + 1) as TileNumber;
    return numberedTile(`black-${number}-1`, "black", number);
  });
  expectValidSet(fullRun, 91, "run 1 through 13");

  expectValidSet(
    [
      jokerTile("joker-1"),
      numberedTile("yellow-4-1", "yellow", 4),
      numberedTile("yellow-5-1", "yellow", 5),
    ],
    12,
    "run with a joker at the start",
  );

  expectValidSet(
    [
      numberedTile("yellow-5-1", "yellow", 5),
      jokerTile("joker-1"),
      numberedTile("yellow-7-1", "yellow", 7),
    ],
    18,
    "run with a joker in the middle",
  );

  expectValidSet(
    [
      numberedTile("red-4-1", "red", 4),
      numberedTile("red-5-1", "red", 5),
      jokerTile("joker-1"),
    ],
    15,
    "run with a joker at the end",
  );

  expectValidSet(
    [
      numberedTile("blue-1-1", "blue", 1),
      jokerTile("joker-1"),
      jokerTile("joker-2"),
      numberedTile("blue-4-1", "blue", 4),
    ],
    10,
    "run whose two jokers fill 2 and 3",
  );

  expectValidSet(
    [
      jokerTile("joker-1"),
      numberedTile("yellow-12-1", "yellow", 12),
      numberedTile("yellow-13-1", "yellow", 13),
    ],
    36,
    "run Joker-12-13",
  );

  expectValidSet(
    [
      numberedTile("red-1-1", "red", 1),
      numberedTile("red-2-1", "red", 2),
      jokerTile("joker-1"),
    ],
    6,
    "run 1-2-Joker",
  );

  expectInvalidSet(
    [
      numberedTile("red-12-1", "red", 12),
      numberedTile("red-13-1", "red", 13),
      jokerTile("joker-1"),
    ],
    "run 12-13-Joker",
  );

  expectInvalidSet(
    [
      jokerTile("joker-1"),
      numberedTile("blue-1-1", "blue", 1),
      numberedTile("blue-2-1", "blue", 2),
    ],
    "run Joker-1-2",
  );

  expectInvalidSet(
    [
      numberedTile("red-12-1", "red", 12),
      numberedTile("red-13-1", "red", 13),
      numberedTile("red-1-1", "red", 1),
    ],
    "run that wraps from 13 to 1",
  );

  expectInvalidSet(
    [
      numberedTile("red-4-1", "red", 4),
      numberedTile("blue-5-1", "blue", 5),
      numberedTile("red-6-1", "red", 6),
    ],
    "run with mixed colors",
  );

  expectInvalidSet(
    [
      numberedTile("red-1-1", "red", 1),
      numberedTile("red-2-1", "red", 2),
      numberedTile("red-4-1", "red", 4),
    ],
    "run with a gap",
  );

  expectInvalidSet(
    [
      numberedTile("red-1-1", "red", 1),
      jokerTile("joker-1"),
      numberedTile("red-4-1", "red", 4),
    ],
    "run whose single joker cannot fill two missing numbers",
  );

  expectInvalidSet(
    [
      numberedTile("red-5-1", "red", 5),
      numberedTile("red-5-2", "red", 5),
      numberedTile("red-6-1", "red", 6),
    ],
    "run with a repeated number",
  );

  expectInvalidSet(
    [
      numberedTile("black-3-1", "black", 3),
      numberedTile("black-1-1", "black", 1),
      numberedTile("black-2-1", "black", 2),
    ],
    "run that is not in ascending order",
  );
}

function verifyInitialMeld(): void {
  const threeTens = [
    numberedTile("red-10-1", "red", 10),
    numberedTile("blue-10-1", "blue", 10),
    numberedTile("black-10-1", "black", 10),
  ];
  const tensWithJoker = [
    numberedTile("red-10-2", "red", 10),
    numberedTile("yellow-10-1", "yellow", 10),
    jokerTile("joker-1"),
  ];
  const runToThirty = [
    numberedTile("blue-9-1", "blue", 9),
    numberedTile("blue-10-1", "blue", 10),
    numberedTile("blue-11-1", "blue", 11),
  ];
  const runBelowThirty = [
    numberedTile("blue-8-1", "blue", 8),
    numberedTile("blue-9-2", "blue", 9),
    numberedTile("blue-10-2", "blue", 10),
  ];
  const runOfFifteen = [
    numberedTile("red-4-1", "red", 4),
    numberedTile("red-5-1", "red", 5),
    numberedTile("red-6-1", "red", 6),
  ];
  const groupOfFifteen = [
    numberedTile("red-5-2", "red", 5),
    numberedTile("yellow-5-1", "yellow", 5),
    numberedTile("black-5-1", "black", 5),
  ];

  expectEqual(calculateSetPoints(threeTens), 30, "three 10s meet the 30-point meld exactly");
  expectEqual(
    calculateSetPoints(threeTens) >= INITIAL_MELD_THRESHOLD,
    true,
    "three 10s pass the initial meld threshold",
  );
  expectEqual(calculateSetPoints(tensWithJoker), 30, "10s with a joker are worth 30");
  expectEqual(calculateSetPoints(runToThirty), 30, "run 9-10-11 is worth 30");
  expectEqual(calculateSetPoints(runBelowThirty), 27, "run 8-9-10 is worth 27");
  expectEqual(
    calculateSetPoints(runBelowThirty) >= INITIAL_MELD_THRESHOLD,
    false,
    "a 27-point run does not meet the initial meld by itself",
  );

  const splitMeld = calculateSetPoints(runOfFifteen) + calculateSetPoints(groupOfFifteen);
  expectEqual(splitMeld, 30, "a 15-point run plus a 15-point group meet the initial meld");

  const invalidTail = [
    numberedTile("red-12-1", "red", 12),
    numberedTile("red-13-1", "red", 13),
    jokerTile("joker-2"),
  ];
  expectEqual(
    calculateSetPoints(invalidTail),
    0,
    "12-13-Joker cannot contribute points to an initial meld",
  );

  expectEqual(
    validateBoard([
      { id: "opening-run", tiles: runToThirty },
      { id: "opening-group", tiles: threeTens },
    ]),
    true,
    "a board of an initial meld is valid",
  );
  expectEqual(
    validateBoard([
      { id: "opening-run", tiles: runToThirty },
      { id: "illegal-tail", tiles: invalidTail },
    ]),
    false,
    "a board containing 12-13-Joker is invalid",
  );
  expectEqual(validateBoard([]), true, "an empty board has no illegal sets");
}

verifyDeck();
verifyGroups();
verifyRuns();
verifyInitialMeld();

console.log(`Rummikub engine verification passed (${assertions} assertions).`);
