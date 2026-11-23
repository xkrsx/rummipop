import { handleInviteAction } from "@/lib/invite/http";
import { cancelInvite } from "@/lib/invite/store";

/** Either player cancels a waiting or ready invitation. */
export async function POST(): Promise<Response> {
  return handleInviteAction((player) => cancelInvite(player.id));
}
