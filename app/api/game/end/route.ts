import { handleMatchAction } from "@/lib/game/match-http";
import { endActiveMatch } from "@/lib/game/match-store";

/** Either seated player aborts the playing match. The result is not recorded. */
export async function POST(): Promise<Response> {
  return handleMatchAction((player) => endActiveMatch(player.id, "manual"));
}
