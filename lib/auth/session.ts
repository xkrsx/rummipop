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

/**
 * The session cookie is present, but the player record could not be loaded.
 * Callers should retry. The cookie stays in place.
 */
export class SessionLookupError extends Error {
  constructor() {
    super("Nie udało się sprawdzić sesji. Połączenie wróci, a logowanie zostanie.");
    this.name = "SessionLookupError";
  }
}

/** Drops the PIN before a player record is sent to the browser. */
export function toSessionPlayer(player: Player): SessionPlayer {
  return {
    id: player.id,
    name: player.name,
    avatar_url: player.avatar_url,
    gamesPlayed: player.gamesPlayed,
    wins: player.wins,
    longestWinStreak: player.longestWinStreak,
    currentWinStreak: player.currentWinStreak,
    fastestWin: player.fastestWin,
    created_at: player.created_at,
  };
}

/**
 * Reads the active player from this request's session cookie.
 * A missing cookie or an unknown player is signed out.
 * A failed lookup throws {@link SessionLookupError} and leaves the cookie in place.
 * Cookie writes are only allowed in a Server Action or Route Handler.
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
    throw new SessionLookupError();
  }
}

/** Stores the signed-in player id. Each browser profile keeps its own cookie. */
export async function writeSessionPlayerId(playerId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, playerId, SESSION_COOKIE_OPTIONS);
}

/** Player id stored in this browser's session cookie, without a player lookup. */
export async function readSessionPlayerId(): Promise<string | null> {
  const cookieStore = await cookies();
  const playerId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (playerId === undefined || playerId.trim().length === 0) {
    return null;
  }

  return playerId;
}

/** Expires the session cookie for the browser that called sign-out. */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
}
