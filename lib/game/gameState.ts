/**
 * Two-player Rummikub match and turn state.
 *
 * Every function is pure: it returns a new state and does not mutate the
 * arguments, including nested tiles and sets. Rule failures throw
 * {@link GameRuleError} with a Polish message that can be shown to the player.
 */

import { calculateSetPoints, validateBoard } from "./rules";
import {
  createDeck,
  shuffleDeck,
  type Tile,
  type TileSet,
} from "./tiles";

/** Tiles dealt to each player at the start of a match. */
export const INITIAL_HAND_SIZE = 14;

/** Lowest total a player's own opening sets must reach. */
export const INITIAL_MELD_POINTS = 30;

export type GameStatus = "waiting" | "playing" | "finished";

/** A player joining a match, before any tiles are dealt. */
export interface MatchPlayer {
  id: string;
  name: string;
}

/** One seat in a two-player match. */
export interface PlayerState {
  id: string;
  name: string;
  hand: Tile[];
  /** False until that player lays down an opening meld of at least 30 points. */
  hasInitialMeld: boolean;
  /** Running score. Dealing and turn resolution leave it unchanged. */
  score: number;
}

/**
 * Table and active rack captured when the turn begins.
 * A commit, a draw, and an undo are all checked against this snapshot.
 */
export interface TurnStartSnapshot {
  board: TileSet[];
  hand: Tile[];
}

/** A fixed two-player Rummikub match. */
export interface GameState {
  id: string;
  status: GameStatus;
  players: [PlayerState, PlayerState];
  /** Seat allowed to play or draw. Stays on the winner when the match ends. */
  currentPlayerIndex: 0 | 1;
  drawPile: Tile[];
  board: TileSet[];
  turnStartSnapshot: TurnStartSnapshot | null;
  winnerId: string | null;
}

/** A rejected deal or turn, with a message safe to show to the player. */
export class GameRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameRuleError";
  }
}

const RULE = {
  twoPlayers: "Gra wymaga dokładnie dwóch graczy.",
  distinctPlayers: "Gracze muszą mieć różne identyfikatory.",
  emptyPlayerId: "Identyfikator gracza nie może być pusty.",
  notPlaying: "Ta gra nie jest w toku.",
  missingSnapshot: "Brak zapisanego stanu tury.",
  inconsistentTurn: "Zapisany stan tury jest niespójny.",
  invalidBoard: "Proponowany układ na stole jest nieprawidłowy.",
  duplicateTiles: "Kafelki w ruchu powtarzają się.",
  foreignTile: "Ruch zawiera kafelek, który nie pochodzi z ręki ani ze stołu.",
  changedTile: "Kafelek w ruchu został zmieniony.",
  boardTilesLost: "Nie można usunąć kafelków ze stołu.",
  handMismatch: "Pozostałe kafelki na ręce nie zgadzają się z tym ruchem.",
  noTilePlayed: "Musisz wyłożyć co najmniej jeden kafelek ze swojej ręki.",
  initialMeld:
    "Pierwsze wyłożenie musi tworzyć własne zestawy warte co najmniej 30 punktów.",
} as const;

function cloneTile(tile: Tile): Tile {
  return {
    id: tile.id,
    color: tile.color,
    number: tile.number,
    isJoker: tile.isJoker,
  };
}

function cloneTiles(tiles: readonly Tile[]): Tile[] {
  return tiles.map(cloneTile);
}

function cloneSet(set: TileSet): TileSet {
  return {
    id: set.id,
    tiles: cloneTiles(set.tiles),
  };
}

function cloneSets(sets: readonly TileSet[]): TileSet[] {
  return sets.map(cloneSet);
}

function clonePlayer(player: PlayerState): PlayerState {
  return {
    id: player.id,
    name: player.name,
    hand: cloneTiles(player.hand),
    hasInitialMeld: player.hasInitialMeld,
    score: player.score,
  };
}

function freshSnapshot(
  board: readonly TileSet[],
  hand: readonly Tile[],
): TurnStartSnapshot {
  return {
    board: cloneSets(board),
    hand: cloneTiles(hand),
  };
}

function createGameId(): string {
  return `game-${globalThis.crypto.randomUUID()}`;
}

function tilesOn(sets: readonly TileSet[]): Tile[] {
  return sets.flatMap((set) => set.tiles);
}

function indexTiles(
  tiles: readonly Tile[],
  duplicateMessage: string,
): Map<string, Tile> {
  const indexed = new Map<string, Tile>();

  for (const tile of tiles) {
    if (indexed.has(tile.id)) {
      throw new GameRuleError(duplicateMessage);
    }
    indexed.set(tile.id, tile);
  }

  return indexed;
}

function assertSameFace(actual: Tile, expected: Tile): void {
  if (
    actual.color !== expected.color ||
    actual.number !== expected.number ||
    actual.isJoker !== expected.isJoker
  ) {
    throw new GameRuleError(RULE.changedTile);
  }
}

function opponentIndex(index: 0 | 1): 0 | 1 {
  return index === 0 ? 1 : 0;
}

function withActivePlayer(
  players: readonly [PlayerState, PlayerState],
  index: 0 | 1,
  active: PlayerState,
): [PlayerState, PlayerState] {
  if (index === 0) {
    return [active, clonePlayer(players[1])];
  }
  return [clonePlayer(players[0]), active];
}

function assertExactlyTwoPlayers(players: readonly MatchPlayer[]): void {
  if (players.length !== 2) {
    throw new GameRuleError(RULE.twoPlayers);
  }

  const [first, second] = players;
  if (
    first === undefined ||
    second === undefined ||
    typeof first.id !== "string" ||
    typeof second.id !== "string" ||
    first.id.trim() === "" ||
    second.id.trim() === ""
  ) {
    throw new GameRuleError(
      first === undefined || second === undefined
        ? RULE.twoPlayers
        : RULE.emptyPlayerId,
    );
  }
  if (first.id === second.id) {
    throw new GameRuleError(RULE.distinctPlayers);
  }
}

function playableSnapshot(state: GameState): TurnStartSnapshot {
  if (state.status !== "playing") {
    throw new GameRuleError(RULE.notPlaying);
  }
  if (state.turnStartSnapshot === null) {
    throw new GameRuleError(RULE.missingSnapshot);
  }
  return state.turnStartSnapshot;
}

/**
 * The opening meld has to be sets built only from tiles this player is laying
 * down now. Sets already on the table do not add to the 30 points, and a new
 * tile only counts when its whole set came from the rack.
 */
function assertInitialMeld(
  proposedBoard: readonly TileSet[],
  playedIds: ReadonlySet<string>,
): void {
  const covered = new Set<string>();
  let points = 0;

  for (const set of proposedBoard) {
    const ownsWholeSet = set.tiles.every((tile) => playedIds.has(tile.id));
    if (!ownsWholeSet) {
      continue;
    }
    points += calculateSetPoints(set.tiles);
    for (const tile of set.tiles) {
      covered.add(tile.id);
    }
  }

  const everyPlayedTileIsInItsOwnSet = [...playedIds].every((id) => covered.has(id));
  if (!everyPlayedTileIsInItsOwnSet || points < INITIAL_MELD_POINTS) {
    throw new GameRuleError(RULE.initialMeld);
  }
}

function seatedPlayer(seat: MatchPlayer, hand: Tile[]): PlayerState {
  return {
    id: seat.id,
    name: seat.name,
    hand,
    hasInitialMeld: false,
    score: 0,
  };
}

/**
 * Deals a two-player match and starts it.
 * The shuffled deck gives 14 tiles to each player, in seat order, and the
 * remainder becomes the draw pile. The first seat plays first.
 * `random` matches `Math.random` and is used only to shuffle.
 */
export function createTwoPlayerGame(
  players: readonly [MatchPlayer, MatchPlayer],
  random: () => number = Math.random,
): GameState {
  assertExactlyTwoPlayers([...players]);

  const [firstSeat, secondSeat] = players;
  const deck = shuffleDeck(createDeck(), random);
  const firstHand = cloneTiles(deck.slice(0, INITIAL_HAND_SIZE));
  const secondHand = cloneTiles(
    deck.slice(INITIAL_HAND_SIZE, INITIAL_HAND_SIZE * 2),
  );
  const drawPile = cloneTiles(deck.slice(INITIAL_HAND_SIZE * 2));

  return {
    id: createGameId(),
    status: "playing",
    players: [seatedPlayer(firstSeat, firstHand), seatedPlayer(secondSeat, secondHand)],
    currentPlayerIndex: 0,
    drawPile,
    board: [],
    turnStartSnapshot: freshSnapshot([], firstHand),
    winnerId: null,
  };
}

/**
 * Commits the active player's turn.
 * The proposal must be a legal board, keep every tile that started on the
 * table, and include at least one tile from the rack captured in
 * `turnStartSnapshot`. The first meld must be worth at least 30 points in
 * sets built only from that rack. An empty rack ends the match.
 */
export function commitTurn(
  state: GameState,
  proposedBoard: readonly TileSet[],
  remainingHand: readonly Tile[],
): GameState {
  const snapshot = playableSnapshot(state);
  if (!validateBoard(proposedBoard)) {
    throw new GameRuleError(RULE.invalidBoard);
  }

  const openingBoard = indexTiles(tilesOn(snapshot.board), RULE.inconsistentTurn);
  const openingHand = indexTiles(snapshot.hand, RULE.inconsistentTurn);
  for (const id of openingBoard.keys()) {
    if (openingHand.has(id)) {
      throw new GameRuleError(RULE.inconsistentTurn);
    }
  }

  const proposed = indexTiles(tilesOn(proposedBoard), RULE.duplicateTiles);
  const kept = indexTiles(remainingHand, RULE.duplicateTiles);

  for (const [id, tile] of proposed) {
    const source = openingBoard.get(id) ?? openingHand.get(id);
    if (source === undefined) {
      throw new GameRuleError(RULE.foreignTile);
    }
    assertSameFace(tile, source);
  }

  for (const id of openingBoard.keys()) {
    if (!proposed.has(id)) {
      throw new GameRuleError(RULE.boardTilesLost);
    }
  }

  for (const [id, tile] of kept) {
    const source = openingHand.get(id);
    if (source === undefined || proposed.has(id)) {
      throw new GameRuleError(RULE.handMismatch);
    }
    assertSameFace(tile, source);
  }

  const playedIds = new Set<string>();
  for (const id of openingHand.keys()) {
    const played = proposed.has(id);
    const stillHeld = kept.has(id);
    if (played === stillHeld) {
      throw new GameRuleError(RULE.handMismatch);
    }
    if (played) {
      playedIds.add(id);
    }
  }

  if (playedIds.size === 0) {
    throw new GameRuleError(RULE.noTilePlayed);
  }

  const index = state.currentPlayerIndex;
  const active = state.players[index];
  if (!active.hasInitialMeld) {
    assertInitialMeld(proposedBoard, playedIds);
  }

  const players = withActivePlayer(state.players, index, {
    id: active.id,
    name: active.name,
    hand: cloneTiles(remainingHand),
    // A legal commit is a later play, or an opening meld that just passed.
    hasInitialMeld: true,
    score: active.score,
  });
  const board = cloneSets(proposedBoard);
  const drawPile = cloneTiles(state.drawPile);

  if (remainingHand.length === 0) {
    return {
      id: state.id,
      status: "finished",
      players,
      currentPlayerIndex: index,
      drawPile,
      board,
      turnStartSnapshot: freshSnapshot(snapshot.board, snapshot.hand),
      winnerId: active.id,
    };
  }

  const nextIndex = opponentIndex(index);
  return {
    id: state.id,
    status: "playing",
    players,
    currentPlayerIndex: nextIndex,
    drawPile,
    board,
    turnStartSnapshot: freshSnapshot(board, players[nextIndex].hand),
    winnerId: null,
  };
}

/**
 * Puts the table and the active rack back to the start of the turn, then ends it.
 * The first tile of the draw pile is added to that restored rack. An empty pile
 * still passes the turn, without giving the player a tile.
 */
export function drawTileAndEndTurn(state: GameState): GameState {
  const snapshot = playableSnapshot(state);
  const index = state.currentPlayerIndex;
  const active = state.players[index];
  const hand = cloneTiles(snapshot.hand);
  const drawPile = cloneTiles(state.drawPile);
  const drawn = drawPile.shift();
  if (drawn !== undefined) {
    hand.push(drawn);
  }

  const board = cloneSets(snapshot.board);
  const players = withActivePlayer(state.players, index, {
    id: active.id,
    name: active.name,
    hand,
    hasInitialMeld: active.hasInitialMeld,
    score: active.score,
  });
  const nextIndex = opponentIndex(index);

  return {
    id: state.id,
    status: "playing",
    players,
    currentPlayerIndex: nextIndex,
    drawPile,
    board,
    turnStartSnapshot: freshSnapshot(board, players[nextIndex].hand),
    winnerId: null,
  };
}

/**
 * Puts the table and the active rack back to `turnStartSnapshot`.
 * The same player stays on turn and nothing is drawn.
 */
export function resetTurn(state: GameState): GameState {
  const snapshot = playableSnapshot(state);
  const index = state.currentPlayerIndex;
  const active = state.players[index];
  const hand = cloneTiles(snapshot.hand);
  const board = cloneSets(snapshot.board);
  const players = withActivePlayer(state.players, index, {
    id: active.id,
    name: active.name,
    hand,
    hasInitialMeld: active.hasInitialMeld,
    score: active.score,
  });

  return {
    id: state.id,
    status: "playing",
    players,
    currentPlayerIndex: index,
    drawPile: cloneTiles(state.drawPile),
    board,
    turnStartSnapshot: freshSnapshot(board, hand),
    winnerId: null,
  };
}
