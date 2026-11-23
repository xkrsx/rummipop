import { handleInviteAction, toInviteParticipant } from "@/lib/invite/http";
import { acceptInvite } from "@/lib/invite/store";

/** Second player confirms the invitation inside the 90-second window. */
export async function POST(): Promise<Response> {
  return handleInviteAction((player) => acceptInvite(toInviteParticipant(player)));
}
