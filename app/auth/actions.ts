"use server";

import { unstable_rethrow } from "next/navigation";
import {
  clearSessionCookie,
  toSessionPlayer,
  writeSessionPlayerId,
} from "@/lib/auth/session";
import { authenticateByPin } from "@/services/playerService";
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

/** Clears the session cookie for the browser that requested sign-out. */
export async function signOut(): Promise<void> {
  await clearSessionCookie();
}
