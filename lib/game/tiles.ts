/**
 * Rummikub tiles and the standard 106-tile deck.
 * Pure data helpers with no UI or I/O dependencies.
 */

export const TILE_COLORS = ["red", "blue", "yellow", "black"] as const;

export type TileColor = (typeof TILE_COLORS)[number];

/** Face value printed on a numbered tile. Jokers have no face value of their own. */
export type TileNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export const MIN_TILE_NUMBER = 1;
export const MAX_TILE_NUMBER = 13;

/** Two full copies of each numbered tile, plus two jokers. */
export const DECK_SIZE = 106;

export interface Tile {
  id: string;
  /** Null on a joker until a set gives it a color. */
  color: TileColor | null;
  /** 1-13 on a numbered tile. Null on a joker until a set gives it a value. */
  number: TileNumber | null;
  isJoker: boolean;
}

export interface TileSet {
  id: string;
  tiles: Tile[];
}

const COPIES_PER_TILE = 2;
const JOKER_COUNT = 2;

export function isTileNumber(value: number | null): value is TileNumber {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_TILE_NUMBER &&
    value <= MAX_TILE_NUMBER
  );
}

/**
 * Builds a standard Rummikub deck: two copies of 1-13 in each of the four
 * colors (104 tiles) and two jokers. Tile ids are stable and unique.
 */
export function createDeck(): Tile[] {
  const deck: Tile[] = [];

  for (let copy = 1; copy <= COPIES_PER_TILE; copy += 1) {
    for (const color of TILE_COLORS) {
      for (let number = MIN_TILE_NUMBER; number <= MAX_TILE_NUMBER; number += 1) {
        deck.push({
          id: `${color}-${number}-${copy}`,
          color,
          number: number as TileNumber,
          isJoker: false,
        });
      }
    }
  }

  for (let copy = 1; copy <= JOKER_COUNT; copy += 1) {
    deck.push({
      id: `joker-${copy}`,
      color: null,
      number: null,
      isJoker: true,
    });
  }

  return deck;
}

/**
 * Returns a new deck order. The input array is not mutated.
 * `random` must return a value in the range [0, 1), matching Math.random.
 */
export function shuffleDeck(
  deck: readonly Tile[],
  random: () => number = Math.random,
): Tile[] {
  const shuffled = [...deck];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }

  return shuffled;
}
