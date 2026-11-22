/**
 * Rummikub set and board validation.
 *
 * A set is either a group or a run:
 * - Group: 3 or 4 tiles of the same number, each a different color.
 * - Run: 3 to 13 tiles of the same color with strictly consecutive numbers.
 *   Order is the order of `tiles`. 13 does not wrap around to 1.
 *
 * A joker has no inherent color or number. Its point value is the face value
 * of the tile it stands in for. When the same tiles can legally be read as
 * both a group and a run, the higher total is used so a 30-point initial meld
 * can count either legal declaration.
 */

import {
  isTileNumber,
  MAX_TILE_NUMBER,
  MIN_TILE_NUMBER,
  TILE_COLORS,
  type Tile,
  type TileColor,
  type TileSet,
} from "./tiles";

const MIN_SET_LENGTH = 3;
const MAX_GROUP_LENGTH = TILE_COLORS.length;
const MAX_RUN_LENGTH = MAX_TILE_NUMBER;

function hasUniqueTileIds(tiles: readonly Tile[]): boolean {
  const ids = new Set<string>();

  for (const tile of tiles) {
    if (ids.has(tile.id)) {
      return false;
    }
    ids.add(tile.id);
  }

  return true;
}

function numberedTiles(tiles: readonly Tile[]): Tile[] {
  return tiles.filter((tile) => !tile.isJoker);
}

/**
 * Points of a group, or null when the tiles are not a group.
 * Every joker is worth the shared number.
 */
function evaluateGroup(tiles: readonly Tile[]): number | null {
  if (tiles.length < MIN_SET_LENGTH || tiles.length > MAX_GROUP_LENGTH) {
    return null;
  }

  const numbered = numberedTiles(tiles);
  if (numbered.length === 0) {
    return null;
  }

  const sharedNumber = numbered[0]?.number ?? null;
  if (!isTileNumber(sharedNumber)) {
    return null;
  }

  const colors = new Set<TileColor>();

  for (const tile of numbered) {
    if (tile.number !== sharedNumber || tile.color === null) {
      return null;
    }
    if (colors.has(tile.color)) {
      return null;
    }
    colors.add(tile.color);
  }

  const jokerCount = tiles.length - numbered.length;
  if (colors.size + jokerCount > MAX_GROUP_LENGTH) {
    return null;
  }

  return sharedNumber * tiles.length;
}

/**
 * Points of a run in the given tile order, or null when that order is not a run.
 * Leading jokers take the numbers immediately below the first numbered tile.
 * Every other joker takes the next consecutive number. Values must stay inside 1-13.
 */
function evaluateRun(tiles: readonly Tile[]): number | null {
  if (tiles.length < MIN_SET_LENGTH || tiles.length > MAX_RUN_LENGTH) {
    return null;
  }

  const anchor = tiles.find((tile) => !tile.isJoker);
  if (!anchor || anchor.color === null || !isTileNumber(anchor.number)) {
    return null;
  }

  const color = anchor.color;
  const values: number[] = [];
  let nextNumber: number | null = null;

  for (const tile of tiles) {
    if (tile.isJoker) {
      if (nextNumber === null) {
        values.push(0);
        continue;
      }
      if (nextNumber > MAX_TILE_NUMBER) {
        return null;
      }
      values.push(nextNumber);
      nextNumber += 1;
      continue;
    }

    if (tile.color !== color || !isTileNumber(tile.number)) {
      return null;
    }

    if (nextNumber === null) {
      const start = tile.number - values.length;
      if (start < MIN_TILE_NUMBER) {
        return null;
      }
      for (let index = 0; index < values.length; index += 1) {
        values[index] = start + index;
      }
      nextNumber = tile.number;
    } else if (tile.number !== nextNumber) {
      return null;
    }

    values.push(tile.number);
    nextNumber += 1;
  }

  if (values.some((value) => !isTileNumber(value))) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0);
}

function legalPointTotals(tiles: readonly Tile[]): number[] {
  if (!hasUniqueTileIds(tiles)) {
    return [];
  }

  const totals: number[] = [];
  const groupPoints = evaluateGroup(tiles);
  const runPoints = evaluateRun(tiles);

  if (groupPoints !== null) {
    totals.push(groupPoints);
  }
  if (runPoints !== null) {
    totals.push(runPoints);
  }

  return totals;
}

/** True when the tiles form a group or a run of at least three tiles. */
export function validateSet(tiles: readonly Tile[]): boolean {
  return legalPointTotals(tiles).length > 0;
}

/**
 * Point value of a valid set, counting each joker as the tile it represents.
 * Returns 0 when the tiles are not a valid set.
 */
export function calculateSetPoints(tiles: readonly Tile[]): number {
  const totals = legalPointTotals(tiles);
  if (totals.length === 0) {
    return 0;
  }

  return Math.max(...totals);
}

/** True when every set on the board is a valid group or run. */
export function validateBoard(sets: readonly TileSet[]): boolean {
  return sets.every((set) => validateSet(set.tiles));
}
