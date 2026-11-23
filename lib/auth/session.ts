import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { getPlayerById } from "@/services/playerService";
import type { Player, SessionPlayer } from "@/types/database";

export const SESSION_COOKIE_NAME = "rummipop_session";

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
};

/** Drops the PIN before a player record is sent to the browser. */
export function toSessionPlayer(player: Player): SessionPlayer {
  return {
    id: player.id,
    name: player.name,
    avatar_url: player.avatar_url,
    games_played: player.games_played,
    games_won: player.games_won,
    fastest_win_seconds: player.fastest_win_seconds,
    created_at: player.created_at,
  };
}

/**
 * Reads the active player from this request's session cookie.
 * A missing, unknown, or unreadable session is treated as signed out.
 * The cookie is not cleared here: cookie writes are only allowed in a
 * Server Action or Route Handler.
 */
export async function readSessionPlayer(): Promise<SessionPlayer | null> {
  try {
    const cookieStore = await cookies();
    const playerId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (playerId === undefined || playerId.trim().length === 0) {
      return null;
    }

    const player = await getPlayerById(playerId);
    if (player === null) {
      return null;
    }

    return toSessionPlayer(player);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

/** Stores the signed-in player id. Each browser profile keeps its own cookie. */
export async function writeSessionPlayerId(playerId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, playerId, SESSION_COOKIE_OPTIONS);
}

/** Expires the session cookie for the browser that called sign-out. */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
}
