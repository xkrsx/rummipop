import { beginMatch } from "@/lib/game/match-store";
import { handleInviteAction, toInviteParticipant } from "@/lib/invite/http";
import { acceptInvite } from "@/lib/invite/store";

function clockMs(serverNow: string): number {
  const parsed = Date.parse(serverNow);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/** Second player confirms the invitation inside the 90-second window. */
export async function POST(): Promise<Response> {
  return handleInviteAction((player) => {
    const snapshot = acceptInvite(toInviteParticipant(player));
    if (
      snapshot.status === "confirmed_ready" &&
      snapshot.host !== null &&
      snapshot.opponent !== null &&
      snapshot.confirmedAt === snapshot.serverNow
    ) {
      beginMatch(
        [
          { id: snapshot.host.id, name: snapshot.host.name },
          { id: snapshot.opponent.id, name: snapshot.opponent.name },
        ],
        clockMs(snapshot.serverNow),
      );
    }

    return snapshot;
  });
}
