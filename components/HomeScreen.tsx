"use client";

import { useCallback, useState } from "react";
import { signInWithPin, signOut } from "@/app/auth/actions";
import { GameLobby } from "@/components/GameLobby";
import { MatchScreen } from "@/components/MatchScreen";
import { PinEntry } from "@/components/PinEntry";
import { PlayerProfile } from "@/components/PlayerProfile";
import type { MatchPhase } from "@/lib/game/match-types";
import type { SessionPlayer } from "@/types/database";

export interface HomeScreenProps {
  initialPlayer: SessionPlayer | null;
}

export function HomeScreen({ initialPlayer }: HomeScreenProps) {
  const [player, setPlayer] = useState<SessionPlayer | null>(initialPlayer);
  const [seenInitialPlayer, setSeenInitialPlayer] = useState(initialPlayer);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [matchOwnerId, setMatchOwnerId] = useState(initialPlayer?.id ?? null);
  const [matchPhase, setMatchPhase] = useState<MatchPhase>("idle");
  const handleMatchPhase = useCallback((phase: MatchPhase) => {
    setMatchPhase(phase);
  }, []);

  if (seenInitialPlayer !== initialPlayer) {
    setSeenInitialPlayer(initialPlayer);
    setPlayer(initialPlayer);
  }

  const playerId = player?.id ?? null;
  if (playerId !== matchOwnerId) {
    setMatchOwnerId(playerId);
    setMatchPhase("idle");
  }

  const handlePinComplete = useCallback(async (pin: string) => {
    const result = await signInWithPin(pin);
    if (!result.ok) {
      throw new Error(result.message);
    }

    setLogoutError(null);
    setPlayer(result.player);
  }, []);

  const handleLogout = useCallback(async () => {
    setLogoutError(null);

    try {
      await signOut();
      setPlayer(null);
    } catch {
      setLogoutError("Nie udało się wylogować. Spróbuj ponownie.");
    }
  }, []);

  if (player === null) {
    return <PinEntry onComplete={handlePinComplete} />;
  }

  return (
    <div key={player.id} className="flex w-full flex-col items-center gap-4">
      <PlayerProfile player={player} onLogout={handleLogout} />
      <MatchScreen playerId={player.id} onPhase={handleMatchPhase} />
      {matchPhase === "playing" ? null : (
        <GameLobby playerId={player.id} matchPhase={matchPhase} />
      )}
      {logoutError !== null ? (
        <p role="alert" className="text-center text-sm font-medium text-red-300">
          {logoutError}
        </p>
      ) : null}
    </div>
  );
}
