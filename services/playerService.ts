import { supabase } from "@/lib/supabase";
import type { Player } from "@/types/database";

const PLAYER_COLUMNS = [
  "id",
  "pin",
  "name",
  "avatar_url",
  "games_played",
  "games_won",
  "fastest_win_seconds",
  "created_at",
] as const satisfies readonly (keyof Player)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isPlayer(value: unknown): value is Player {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.pin === "string" &&
    typeof value.name === "string" &&
    isNullableString(value.avatar_url) &&
    typeof value.games_played === "number" &&
    typeof value.games_won === "number" &&
    isNullableNumber(value.fastest_win_seconds) &&
    typeof value.created_at === "string"
  );
}

function readErrorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return "Failed to query players";
}

async function findPlayer(
  column: "id" | "pin",
  value: string,
): Promise<Player | null> {
  const { data, error } = await supabase
    .from("players")
    .select(PLAYER_COLUMNS.join(", "))
    .eq(column, value)
    .maybeSingle();

  if (error) {
    throw new Error(readErrorMessage(error));
  }

  if (data === null) {
    return null;
  }

  if (!isPlayer(data)) {
    throw new Error("Player row did not match the expected shape");
  }

  return data;
}

/** Looks up one of the fixed players by PIN. Returns null when no row matches. */
export function authenticateByPin(pin: string): Promise<Player | null> {
  return findPlayer("pin", pin);
}

/** Reloads a fixed player from the session cookie's player id. */
export function getPlayerById(playerId: string): Promise<Player | null> {
  return findPlayer("id", playerId);
}
