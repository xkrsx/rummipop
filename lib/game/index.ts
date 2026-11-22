export {
  DECK_SIZE,
  MAX_TILE_NUMBER,
  MIN_TILE_NUMBER,
  TILE_COLORS,
  createDeck,
  isTileNumber,
  shuffleDeck,
} from "./tiles";
export type { Tile, TileColor, TileNumber, TileSet } from "./tiles";

export { calculateSetPoints, validateBoard, validateSet } from "./rules";
