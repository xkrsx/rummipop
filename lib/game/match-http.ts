import { unstable_rethrow } from "next/navigation";
import { SessionLookupError, readSessionPlayer } from "@/lib/auth/session";
import { MatchFlowError, runMatchFlow } from "@/lib/game/match-store";
import type { MatchSnapshot } from "@/lib/game/match-types";
import type { SessionPlayer } from "@/types/database";

const UNAUTHENTICATED_MESSAGE = "Zaloguj się, aby grać.";
const UNEXPECTED_MESSAGE = "Nie udało się zsynchronizować partii. Spróbuj ponownie.";

export function matchJson(
  body: MatchSnapshot | { message: string; snapshot?: MatchSnapshot | null },
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

/** Requires a session, then runs one match transition at a time. */
export async function handleMatchAction(
  action: (player: SessionPlayer) => MatchSnapshot,
): Promise<Response> {
  try {
    const player = await readSessionPlayer();
    if (player === null) {
      return matchJson({ message: UNAUTHENTICATED_MESSAGE }, 401);
    }

    const snapshot = await runMatchFlow(() => action(player));
    return matchJson(snapshot);
  } catch (error) {
    unstable_rethrow(error);

    if (error instanceof SessionLookupError) {
      return matchJson({ message: error.message }, 503);
    }

    if (error instanceof MatchFlowError) {
      return matchJson(
        error.snapshot === null
          ? { message: error.message }
          : { message: error.message, snapshot: error.snapshot },
        error.statusCode,
      );
    }

    return matchJson({ message: UNEXPECTED_MESSAGE }, 500);
  }
}
