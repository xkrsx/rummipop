"use client";

import { useCallback, useEffect, useState } from "react";
import { signInWithPin, signOut } from "@/app/auth/actions";
import { GameLobby } from "@/components/GameLobby";
import { PinEntry } from "@/components/PinEntry";
import { PlayerProfile } from "@/components/PlayerProfile";
import type { SessionPlayer } from "@/types/database";

export interface HomeScreenProps {
  initialPlayer: SessionPlayer | null;
}

export function HomeScreen({ initialPlayer }: HomeScreenProps) {
  const [player, setPlayer] = useState<SessionPlayer | null>(initialPlayer);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    setPlayer(initialPlayer);
  }, [initialPlayer]);

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
    <div className="flex w-full flex-col items-center gap-4">
      <PlayerProfile player={player} onLogout={handleLogout} />
      <GameLobby key={player.id} playerId={player.id} />
      {logoutError !== null ? (
        <p role="alert" className="text-center text-sm font-medium text-red-300">
          {logoutError}
        </p>
      ) : null}
    </div>
  );
}
