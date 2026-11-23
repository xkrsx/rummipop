import {
  applyMatchToPlayerStats,
  drainNormalWins,
  emptyPlayerStats,
  requeueNormalWins,
  type NormalWin,
} from "@/lib/game/player-stats";
import { supabase } from "@/lib/supabase";
import type { Player, PlayerStats } from "@/types/database";

const FULL_COLUMNS = [
  "id",
  "pin",
  "name",
  "avatar_url",
  "games_played",
  "wins",
  "longest_win_streak",
  "current_win_streak",
  "fastest_win",
  "created_at",
] as const;

const LEGACY_COLUMNS = [
  "id",
  "pin",
  "name",
  "avatar_url",
  "games_played",
  "games_won",
  "fastest_win_seconds",
  "created_at",
] as const;

type StatsSchema = "unknown" | "full" | "legacy";

/**
 * Streaks and the fastest turn count for a database that still only has
 * games played and games won. Cleared once the full columns accept a write.
 */
const legacyOverlay = new Map<string, PlayerStats>();

let statsSchema: StatsSchema = "unknown";

/**
 * Raised when a win was written for one player and the other write could not
 * be rolled back. That match must not be applied again.
 */
export class PartialStatsWriteError extends Error {
  constructor() {
    super("Player stats were only saved for one side of the match");
    this.name = "PartialStatsWriteError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isMissingColumn(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  if (error.code === "42703") {
    return true;
  }

  return typeof error.message === "string" && /column .* does not exist/i.test(error.message);
}

function readErrorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return "Failed to query players";
}

function statsOf(player: Player): PlayerStats {
  return {
    gamesPlayed: player.gamesPlayed,
    wins: player.wins,
    longestWinStreak: player.longestWinStreak,
    currentWinStreak: player.currentWinStreak,
    fastestWin: player.fastestWin,
  };
}

function playerFromRow(row: Record<string, unknown>, stats: PlayerStats): Player {
  if (
    typeof row.id !== "string" ||
    typeof row.pin !== "string" ||
    typeof row.name !== "string" ||
    !isNullableString(row.avatar_url) ||
    typeof row.created_at !== "string"
  ) {
    throw new Error("Player row did not match the expected shape");
  }

  return {
    id: row.id,
    pin: row.pin,
    name: row.name,
    avatar_url: row.avatar_url,
    created_at: row.created_at,
    ...stats,
  };
}

function fullStats(row: Record<string, unknown>): PlayerStats {
  if (
    typeof row.games_played !== "number" ||
    typeof row.wins !== "number" ||
    typeof row.longest_win_streak !== "number" ||
    typeof row.current_win_streak !== "number" ||
    !isNullableNumber(row.fastest_win)
  ) {
    throw new Error("Player row did not match the expected shape");
  }

  return {
    gamesPlayed: row.games_played,
    wins: row.wins,
    longestWinStreak: row.longest_win_streak,
    currentWinStreak: row.current_win_streak,
    fastestWin: row.fastest_win,
  };
}

function legacyStatsFor(row: Record<string, unknown>): PlayerStats {
  const overlay = typeof row.id === "string" ? legacyOverlay.get(row.id) : undefined;
  if (overlay !== undefined) {
    return overlay;
  }

  return {
    ...emptyPlayerStats(),
    gamesPlayed: typeof row.games_played === "number" ? row.games_played : 0,
    wins: typeof row.games_won === "number" ? row.games_won : 0,
  };
}

async function selectColumns(
  column: "id" | "pin",
  value: string,
  columns: readonly string[],
): Promise<{ data: unknown; error: unknown }> {
  return supabase.from("players").select(columns.join(", ")).eq(column, value).maybeSingle();
}

async function findPlayer(column: "id" | "pin", value: string): Promise<Player | null> {
  if (statsSchema !== "legacy") {
    const full = await selectColumns(column, value, FULL_COLUMNS);
    if (!full.error) {
      statsSchema = "full";
      if (full.data === null) {
        return null;
      }
      if (!isRecord(full.data)) {
        throw new Error("Player row did not match the expected shape");
      }
      return playerFromRow(full.data, fullStats(full.data));
    }

    if (!isMissingColumn(full.error)) {
      throw new Error(readErrorMessage(full.error));
    }

    statsSchema = "legacy";
  }

  const legacy = await selectColumns(column, value, LEGACY_COLUMNS);
  if (legacy.error) {
    throw new Error(readErrorMessage(legacy.error));
  }

  if (legacy.data === null) {
    return null;
  }

  if (!isRecord(legacy.data)) {
    throw new Error("Player row did not match the expected shape");
  }

  return playerFromRow(legacy.data, legacyStatsFor(legacy.data));
}

async function saveFullStats(playerId: string, stats: PlayerStats): Promise<void> {
  const { data, error } = await supabase
    .from("players")
    .update({
      games_played: stats.gamesPlayed,
      wins: stats.wins,
      longest_win_streak: stats.longestWinStreak,
      current_win_streak: stats.currentWinStreak,
      fastest_win: stats.fastestWin,
    })
    .eq("id", playerId)
    .select("id");

  if (error) {
    throw error;
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Player stats were not updated");
  }
}

async function saveLegacyStats(playerId: string, stats: PlayerStats): Promise<void> {
  const { data, error } = await supabase
    .from("players")
    .update({
      games_played: stats.gamesPlayed,
      games_won: stats.wins,
    })
    .eq("id", playerId)
    .select("id");

  if (error) {
    throw new Error(readErrorMessage(error));
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Player stats were not updated");
  }

  legacyOverlay.set(playerId, stats);
}

async function savePlayerStats(playerId: string, stats: PlayerStats): Promise<void> {
  if (statsSchema !== "legacy") {
    try {
      await saveFullStats(playerId, stats);
      statsSchema = "full";
      legacyOverlay.delete(playerId);
      return;
    } catch (error) {
      if (statsSchema === "full" || !isMissingColumn(error)) {
        throw new Error(readErrorMessage(error));
      }

      statsSchema = "legacy";
    }
  }

  await saveLegacyStats(playerId, stats);
}

async function persistNormalWin(win: NormalWin): Promise<void> {
  const [winner, loser] = await Promise.all([
    getPlayerById(win.winnerId),
    getPlayerById(win.loserId),
  ]);

  if (winner === null || loser === null) {
    throw new Error("Finished match refers to an unknown player");
  }

  const previousWinner = statsOf(winner);
  const nextWinner = applyMatchToPlayerStats(previousWinner, {
    won: true,
    winningTurnCount: win.winningTurnCount,
  });
  const nextLoser = applyMatchToPlayerStats(statsOf(loser), {
    won: false,
    winningTurnCount: win.winningTurnCount,
  });

  await savePlayerStats(winner.id, nextWinner);

  try {
    await savePlayerStats(loser.id, nextLoser);
  } catch (error) {
    try {
      await savePlayerStats(winner.id, previousWinner);
    } catch {
      throw new PartialStatsWriteError();
    }

    throw error;
  }
}

/**
 * Writes every queued normal win. A failed write is put back so the next
 * match request can try again. A partial write is left recorded.
 */
export async function flushNormalWinStats(): Promise<void> {
  const wins = drainNormalWins();

  for (let index = 0; index < wins.length; index += 1) {
    const win = wins[index];
    if (win === undefined) {
      continue;
    }

    try {
      await persistNormalWin(win);
    } catch (error) {
      if (!(error instanceof PartialStatsWriteError)) {
        requeueNormalWins(wins.slice(index));
      } else if (index + 1 < wins.length) {
        requeueNormalWins(wins.slice(index + 1));
      }

      throw error;
    }
  }
}

/** Looks up one of the fixed players by PIN. Returns null when no row matches. */
export function authenticateByPin(pin: string): Promise<Player | null> {
  return findPlayer("pin", pin);
}

/** Reloads a fixed player from the session cookie's player id. */
export function getPlayerById(playerId: string): Promise<Player | null> {
  return findPlayer("id", playerId);
}
