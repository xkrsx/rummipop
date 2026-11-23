import { handleInviteAction, toInviteParticipant } from "@/lib/invite/http";
import { openInvite, readInvite } from "@/lib/invite/store";

/** Polled by both players. Expiry is applied on the server before the response. */
export async function GET(): Promise<Response> {
  return handleInviteAction((player) => readInvite(player.id));
}

/** Host starts a match invitation that expires after 90 seconds. */
export async function POST(): Promise<Response> {
  return handleInviteAction((player) => openInvite(toInviteParticipant(player)));
}
