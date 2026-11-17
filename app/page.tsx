"use client";

import { useCallback, useEffect, useState } from "react";
import { PinEntry } from "@/components/PinEntry";
import { PlayerProfile } from "@/components/PlayerProfile";
import { authenticateByPin, getPlayerByPin } from "@/services/playerService";
import type { Player } from "@/types/database";

const SESSION_PIN_KEY = "rummipop.session.pin";

type AuthStatus = "restoring" | "anonymous" | "authenticated";

function readStoredPin(): string | null {
  try {
    const value = window.sessionStorage.getItem(SESSION_PIN_KEY);
    if (value === null || value.trim().length === 0) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function writeStoredPin(pin: string): void {
  try {
    window.sessionStorage.setItem(SESSION_PIN_KEY, pin);
  } catch {
    // Private browsing can block storage. The in-memory session still works.
  }
}

function clearStoredPin(): void {
  try {
    window.sessionStorage.removeItem(SESSION_PIN_KEY);
  } catch {
    // Logout still clears the in-memory session when storage is unavailable.
  }
}

export default function Home() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("restoring");
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);

  useEffect(() => {
    const pin = readStoredPin();
    if (pin === null) {
      setAuthStatus("anonymous");
      return;
    }

    let alive = true;

    void getPlayerByPin(pin)
      .then((player) => {
        if (!alive) {
          return;
        }

        if (player === null) {
          clearStoredPin();
          setCurrentPlayer(null);
          setAuthStatus("anonymous");
          return;
        }

        setCurrentPlayer(player);
        setAuthStatus("authenticated");
      })
      .catch(() => {
        if (!alive) {
          return;
        }

        clearStoredPin();
        setCurrentPlayer(null);
        setAuthStatus("anonymous");
      });

    return () => {
      alive = false;
    };
  }, []);

  const handlePinComplete = useCallback(async (pin: string) => {
    const player = await authenticateByPin(pin);
    if (player === null) {
      throw new Error("Nie znaleziono gracza o tym PIN-ie");
    }

    writeStoredPin(player.pin);
    setCurrentPlayer(player);
    setAuthStatus("authenticated");
  }, []);

  const handleLogout = useCallback(() => {
    clearStoredPin();
    setCurrentPlayer(null);
    setAuthStatus("anonymous");
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 text-white">
      {authStatus === "restoring" ? (
        <p className="flex items-center gap-2 text-sm font-medium text-zinc-300">
          <span
            className="size-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-100"
            aria-hidden="true"
          />
          Przywracanie sesji
        </p>
      ) : null}
      {authStatus === "anonymous" ? (
        <PinEntry onComplete={handlePinComplete} />
      ) : null}
      {authStatus === "authenticated" && currentPlayer !== null ? (
        <PlayerProfile player={currentPlayer} onLogout={handleLogout} />
      ) : null}
    </main>
  );
}
