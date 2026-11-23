import { handleMatchAction } from "@/lib/game/match-http";
import { drawMatchTile } from "@/lib/game/match-store";

/** Active player draws one tile and passes, unless the server clock already did. */
export async function POST(): Promise<Response> {
  return handleMatchAction((player) => drawMatchTile(player.id));
}
