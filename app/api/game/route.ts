import type { MatchPlayer } from "@/lib/game/gameState";
import { handleMatchAction } from "@/lib/game/match-http";
import { readMatch } from "@/lib/game/match-store";
import { readInvite } from "@/lib/invite/store";

function readyPlayers(playerId: string): readonly [MatchPlayer, MatchPlayer] | null {
  const invite = readInvite(playerId);
  if (invite.status !== "confirmed_ready" || invite.host === null || invite.opponent === null) {
    return null;
  }

  return [
    { id: invite.host.id, name: invite.host.name },
    { id: invite.opponent.id, name: invite.opponent.name },
  ];
}

/** Polled by both players. Elapsed turns are closed before the response. */
export async function GET(): Promise<Response> {
  return handleMatchAction((player) => readMatch(player.id, readyPlayers(player.id)));
}
