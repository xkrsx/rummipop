import { createTwoPlayerGame, drawTileAndEndTurn, resolveExpiredTurns, type GameState, type MatchPlayer, type TurnTimeout } from "@/lib/game/gameState";
import type { MatchPhase, MatchSeatView, MatchSnapshot } from "@/lib/game/match-types";

const STORE_KEY = "__rummipopMatchStore";

/** Why a playing match was closed without recording a result. */
export type MatchEndReason = "manual" | "logout";

interface MatchClosure {
  reason: MatchEndReason;
  playerId: string;
  playerName: string;
}

interface MatchRecord {
  game: GameState;
  notice: string | null;
  /** Set when a player ends the match or logs out. Timeouts stop after this. */
  closure: MatchClosure | null;
}

interface MatchStore {
  record: MatchRecord | null;
  revision: number;
  queue: Promise<void>;
}

export class MatchFlowError extends Error {
  readonly statusCode: number;
  readonly snapshot: MatchSnapshot | null;

  constructor(message: string, statusCode: number, snapshot: MatchSnapshot | null = null) {
    super(message);
    this.name = "MatchFlowError";
    this.statusCode = statusCode;
    this.snapshot = snapshot;
  }
}

function getStore(): MatchStore {
  const scope = globalThis as typeof globalThis & {
    [STORE_KEY]?: MatchStore;
  };

  let matchStore = scope[STORE_KEY];
  if (matchStore === undefined) {
    matchStore = {
      record: null,
      revision: 0,
      queue: Promise.resolve(),
    };
    scope[STORE_KEY] = matchStore;
  }

  return matchStore;
}

/**
 * Serializes match transitions. Route handlers await auth before they
 * touch the store, so two requests must not interleave those writes.
 */
export function runMatchFlow<T>(task: () => T): Promise<T> {
  const matchStore = getStore();
  const result = matchStore.queue.then(task);
  matchStore.queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function markChanged(): void {
  getStore().revision += 1;
}

function samePlayers(game: GameState, players: readonly [MatchPlayer, MatchPlayer]): boolean {
  const seated = new Set(game.players.map((player) => player.id));
  return seated.size === 2 && seated.has(players[0].id) && seated.has(players[1].id);
}

function describeTimeouts(timeouts: readonly TurnTimeout[]): string {
  if (timeouts.length > 1) {
    return "Minął limit czasu więcej niż jednej tury. Niezakończone ruchy wróciły do początku każdej z nich, a brakujące kafelki zostały dobrane, jeśli stos nie był pusty.";
  }

  const timeout = timeouts[0];
  if (timeout === undefined) {
    return "Czas tury minął. Kolejka przeszła dalej.";
  }

  if (timeout.drewTile) {
    return "Czas tury minął. Układ wrócił do początku tury, dobrano 1 kafelek i kolejka przeszła dalej.";
  }

  return "Czas tury minął. Układ wrócił do początku tury. Stos jest pusty, więc kolejka przeszła dalej bez dobierania.";
}

function seatView(player: GameState["players"][number]): MatchSeatView {
  return {
    id: player.id,
    name: player.name,
    handCount: player.hand.length,
  };
}

function idleSnapshot(now: number): MatchSnapshot {
  return {
    revision: getStore().revision,
    phase: "idle",
    serverNow: new Date(now).toISOString(),
    gameId: null,
    you: null,
    opponent: null,
    currentPlayerId: null,
    isYourTurn: false,
    turnExpiresAt: null,
    remainingMs: 0,
    drawPileCount: 0,
    winnerId: null,
    notice: null,
  };
}

function phaseOf(record: MatchRecord): MatchPhase {
  if (record.closure !== null) {
    return "aborted";
  }

  if (record.game.status === "finished") {
    return "finished";
  }

  return "playing";
}

/** Marta is addressed and described in the feminine. Kuba uses the masculine. */
function usesFemininePolish(name: string): boolean {
  return name.trim().toLocaleLowerCase("pl-PL") === "marta";
}

function closureMessage(closure: MatchClosure, viewerId: string): string {
  const feminine = usesFemininePolish(closure.playerName);
  const self = closure.playerId === viewerId;

  if (closure.reason === "logout") {
    if (self) {
      return feminine
        ? "Wylogowałaś się. Partia została przerwana i nie została zapisana."
        : "Wylogowałeś się. Partia została przerwana i nie została zapisana.";
    }

    return feminine
      ? `${closure.playerName} wylogowała się. Partia została przerwana i nie została zapisana.`
      : `${closure.playerName} wylogował się. Partia została przerwana i nie została zapisana.`;
  }

  if (self) {
    return feminine
      ? "Zakończyłaś partię. Gra nie została zapisana."
      : "Zakończyłeś partię. Gra nie została zapisana.";
  }

  return feminine
    ? `${closure.playerName} zakończyła partię. Gra nie została zapisana.`
    : `${closure.playerName} zakończył partię. Gra nie została zapisana.`;
}

function toSnapshot(record: MatchRecord | null, playerId: string, now: number): MatchSnapshot {
  if (record === null) {
    return idleSnapshot(now);
  }

  const game = record.game;
  const youIndex = game.players[0].id === playerId ? 0 : game.players[1].id === playerId ? 1 : null;
  if (youIndex === null) {
    return idleSnapshot(now);
  }

  const opponentIndex = youIndex === 0 ? 1 : 0;
  const closed = record.closure !== null;
  const current = game.players[game.currentPlayerIndex];
  const expiresAt = !closed && game.status === "playing" ? game.turnExpiresAt : null;
  const remainingMs =
    expiresAt === null ? 0 : Math.max(0, expiresAt - now);

  return {
    revision: getStore().revision,
    phase: phaseOf(record),
    serverNow: new Date(now).toISOString(),
    gameId: game.id,
    you: seatView(game.players[youIndex]),
    opponent: seatView(game.players[opponentIndex]),
    currentPlayerId: closed ? null : current.id,
    isYourTurn: !closed && game.status === "playing" && current.id === playerId,
    turnExpiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
    remainingMs,
    drawPileCount: game.drawPile.length,
    winnerId: closed ? null : game.winnerId,
    notice: record.closure === null ? record.notice : closureMessage(record.closure, playerId),
  };
}

function requireSeat(record: MatchRecord, playerId: string, now: number): MatchSnapshot {
  const seated = record.game.players.some((player) => player.id === playerId);
  if (!seated) {
    throw new MatchFlowError("Nie bierzesz udziału w tej partii.", 403, null);
  }

  return toSnapshot(record, playerId, now);
}

/** Applies every deadline that has already passed and records a Polish notice. */
function settle(now: number): MatchRecord | null {
  const record = getStore().record;
  if (record === null || record.closure !== null) {
    return record;
  }

  const resolved = resolveExpiredTurns(record.game, now);
  if (resolved.timeouts.length === 0) {
    return record;
  }

  record.game = resolved.state;
  record.notice = describeTimeouts(resolved.timeouts);
  markChanged();
  return record;
}

function replaceMatch(players: readonly [MatchPlayer, MatchPlayer], now: number): void {
  getStore().record = {
    game: createTwoPlayerGame(players, Math.random, now),
    notice: null,
    closure: null,
  };
  markChanged();
}

/**
 * Opens a match for the two confirmed players.
 * A match that is already in play for the same pair is left as it is.
 * A finished match is replaced so the next confirmation can start again.
 */
export function beginMatch(
  players: readonly [MatchPlayer, MatchPlayer],
  now = Date.now(),
): void {
  const current = getStore().record;
  if (
    current !== null &&
    current.closure === null &&
    current.game.status === "playing" &&
    samePlayers(current.game, players)
  ) {
    return;
  }

  replaceMatch(players, now);
}

function createIfAbsent(players: readonly [MatchPlayer, MatchPlayer], now: number): void {
  if (getStore().record !== null) {
    return;
  }

  replaceMatch(players, now);
}

/**
 * Current match for the signed-in player, with elapsed turns already closed.
 * `readyPlayers` deals a match only when the server does not have one yet.
 */
export function readMatch(
  playerId: string,
  readyPlayers: readonly [MatchPlayer, MatchPlayer] | null = null,
  now = Date.now(),
): MatchSnapshot {
  if (
    readyPlayers !== null &&
    (readyPlayers[0].id === playerId || readyPlayers[1].id === playerId)
  ) {
    createIfAbsent(readyPlayers, now);
  }

  const record = settle(now);
  if (record === null) {
    return idleSnapshot(now);
  }

  return requireSeat(record, playerId, now);
}

/**
 * Active player chooses to draw instead of committing a layout.
 * A deadline that already passed is applied first and the draw is refused,
 * so a late request cannot take a second tile.
 */
export function drawMatchTile(playerId: string, now = Date.now()): MatchSnapshot {
  const revisionBefore = getStore().revision;
  const record = settle(now);
  if (record === null) {
    throw new MatchFlowError("Nie ma rozpoczętej partii.", 409, idleSnapshot(now));
  }

  const snapshot = requireSeat(record, playerId, now);
  if (record.closure !== null) {
    throw new MatchFlowError("Ta partia została przerwana.", 409, snapshot);
  }

  if (getStore().revision !== revisionBefore) {
    throw new MatchFlowError(
      record.notice ?? "Czas tury minął. Kolejka przeszła dalej.",
      409,
      snapshot,
    );
  }

  const game = record.game;
  if (game.status !== "playing") {
    throw new MatchFlowError("Ta partia już się zakończyła.", 409, snapshot);
  }

  if (game.players[game.currentPlayerIndex].id !== playerId) {
    throw new MatchFlowError("Teraz jest tura drugiego gracza.", 409, snapshot);
  }

  record.game = drawTileAndEndTurn(game, now);
  record.notice = null;
  markChanged();
  return toSnapshot(record, playerId, now);
}

/**
 * Closes the playing match without a winner and without a recorded score.
 * A logout with no playing match is ignored. A second close keeps the first reason.
 * Timeouts are not applied: a disconnect never reaches this function.
 */
export function endActiveMatch(
  playerId: string,
  reason: MatchEndReason,
  now = Date.now(),
): MatchSnapshot {
  const record = getStore().record;
  if (record === null) {
    if (reason === "logout") {
      return idleSnapshot(now);
    }

    throw new MatchFlowError("Nie ma rozpoczętej partii.", 409, idleSnapshot(now));
  }

  const seated = record.game.players.some((player) => player.id === playerId);
  if (!seated) {
    if (reason === "logout") {
      return idleSnapshot(now);
    }

    throw new MatchFlowError("Nie bierzesz udziału w tej partii.", 403, null);
  }

  if (record.closure !== null) {
    return toSnapshot(record, playerId, now);
  }

  if (record.game.status !== "playing") {
    if (reason === "logout") {
      return toSnapshot(record, playerId, now);
    }

    throw new MatchFlowError("Ta partia już się zakończyła.", 409, toSnapshot(record, playerId, now));
  }

  const actor = record.game.players.find((player) => player.id === playerId);
  record.closure = {
    reason,
    playerId,
    playerName: actor?.name ?? "Gracz",
  };
  record.notice = null;
  markChanged();
  return toSnapshot(record, playerId, now);
}
