"use server";

import { unstable_rethrow } from "next/navigation";
import {
  SessionLookupError,
  clearSessionCookie,
  readSessionPlayer,
  readSessionPlayerId,
  toSessionPlayer,
  writeSessionPlayerId,
} from "@/lib/auth/session";
import { endActiveMatch, runMatchFlow } from "@/lib/game/match-store";
import { cancelInviteOnLogout, runInviteFlow } from "@/lib/invite/store";
import { authenticateByPin, flushNormalWinStats } from "@/services/playerService";
import type { SessionPlayer } from "@/types/database";

const INVALID_PIN_MESSAGE = "Nie znaleziono gracza o tym PIN-ie";
const SIGN_IN_FAILED_MESSAGE = "Nie udało się zalogować. Spróbuj ponownie.";

export type SignInResult =
  | { ok: true; player: SessionPlayer }
  | { ok: false; message: string };

function isSixDigitPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

/**
 * Checks the PIN against the two fixed players and stores the match
 * in this browser's session cookie.
 */
export async function signInWithPin(pin: string): Promise<SignInResult> {
  if (!isSixDigitPin(pin)) {
    return { ok: false, message: INVALID_PIN_MESSAGE };
  }

  try {
    const player = await authenticateByPin(pin);
    if (player === null) {
      return { ok: false, message: INVALID_PIN_MESSAGE };
    }

    await writeSessionPlayerId(player.id);
    return { ok: true, player: toSessionPlayer(player) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: SIGN_IN_FAILED_MESSAGE };
  }
}

/** Reloads the signed-in player's match record after a finished game. */
export async function reloadSignedInPlayer(): Promise<
  | { ok: true; player: SessionPlayer }
  | { ok: false; message: string }
> {
  try {
    const player = await readSessionPlayer();
    if (player === null) {
      return { ok: false, message: "Sesja wygasła. Zaloguj się ponownie." };
    }

    return { ok: true, player };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof SessionLookupError) {
      return { ok: false, message: error.message };
    }

    return { ok: false, message: "Nie udało się odświeżyć statystyk." };
  }
}

/**
 * Drops an unaccepted invitation and a playing match for this browser,
 * then clears its session cookie.
 * The cookie is read locally. A failed player lookup must not reach this
 * path: network errors stay on the poll and leave the invitation, the match, and the session.
 */
export async function signOut(): Promise<void> {
  const playerId = await readSessionPlayerId();
  if (playerId !== null) {
    await runInviteFlow(() => {
      cancelInviteOnLogout(playerId);
    });
    await runMatchFlow(() => {
      endActiveMatch(playerId, "logout");
    });
    try {
      await flushNormalWinStats();
    } catch (error) {
      unstable_rethrow(error);
      // A logout never records the match it just closed. A normal win that was
      // already queued stays queued when this write fails.
    }
  }

  await clearSessionCookie();
}
