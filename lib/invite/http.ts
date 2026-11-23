import { unstable_rethrow } from "next/navigation";
import { readSessionPlayer } from "@/lib/auth/session";
import { InviteFlowError, runInviteFlow } from "@/lib/invite/store";
import type { InviteParticipant, InviteSnapshot } from "@/lib/invite/types";
import type { SessionPlayer } from "@/types/database";

const UNAUTHENTICATED_MESSAGE = "Zaloguj się, aby dołączyć do partii.";
const UNEXPECTED_MESSAGE = "Nie udało się zaktualizować zaproszenia. Spróbuj ponownie.";

export function toInviteParticipant(player: SessionPlayer): InviteParticipant {
  return {
    id: player.id,
    name: player.name,
    avatarUrl: player.avatar_url,
  };
}

export function inviteJson(body: InviteSnapshot | { message: string }, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

/** Requires a session, then runs one invite transition at a time. */
export async function handleInviteAction(
  action: (player: SessionPlayer) => InviteSnapshot,
): Promise<Response> {
  try {
    const player = await readSessionPlayer();
    if (player === null) {
      return inviteJson({ message: UNAUTHENTICATED_MESSAGE }, 401);
    }

    const snapshot = await runInviteFlow(() => action(player));
    return inviteJson(snapshot);
  } catch (error) {
    unstable_rethrow(error);

    if (error instanceof InviteFlowError) {
      return inviteJson({ message: error.message }, error.statusCode);
    }

    return inviteJson({ message: UNEXPECTED_MESSAGE }, 500);
  }
}
