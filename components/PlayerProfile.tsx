"use client";

import { useState } from "react";
import type { SessionPlayer } from "@/types/database";

export interface PlayerProfileProps {
  player: SessionPlayer;
  onLogout: () => void | Promise<void>;
}

interface PlayerAvatarProps {
  name: string;
  avatarUrl: string | null;
  initials: string;
}

interface StatProps {
  label: string;
  value: string;
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);

  if (parts.length === 0) {
    return "?";
  }

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toLocaleUpperCase("pl-PL");
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("pl-PL").format(value);
}

function turnsWord(turns: number): string {
  const last = turns % 10;
  const lastTwo = turns % 100;

  if (turns === 1) {
    return "tura";
  }

  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return "tury";
  }

  return "tur";
}

function formatFastestWin(turns: number | null): string {
  if (turns === null) {
    return "Brak rekordu";
  }

  return `${formatCount(turns)} ${turnsWord(turns)}`;
}

/**
 * Signed-in player card: greeting, match stats, and an explicit logout action.
 * The PIN is never rendered.
 */
export function PlayerProfile({ player, onLogout }: PlayerProfileProps) {
  const initials = initialsFromName(player.name);

  return (
    <section
      aria-label={`Profil gracza ${player.name}`}
      className="mx-auto flex w-full max-w-sm flex-col gap-8 rounded-3xl border border-zinc-800 bg-zinc-900 px-6 py-8 shadow-sm select-none"
    >
      <header className="flex flex-col items-center gap-4 text-center">
        <PlayerAvatar
          name={player.name}
          avatarUrl={player.avatar_url}
          initials={initials}
        />
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Witaj, {player.name}!
          </h2>
          <p className="text-sm text-zinc-400">Jesteś przy stole</p>
        </div>
      </header>

      <dl className="grid grid-cols-1 gap-3">
        <Stat label="Rozegrane partie" value={formatCount(player.gamesPlayed)} />
        <Stat label="Wygrane" value={formatCount(player.wins)} />
        <Stat label="Najdłuższa seria zwycięstw" value={formatCount(player.longestWinStreak)} />
        <Stat label="Aktualna seria zwycięstw" value={formatCount(player.currentWinStreak)} />
        <Stat label="Najszybsze zwycięstwo" value={formatFastestWin(player.fastestWin)} />
      </dl>

      <button
        type="button"
        onClick={onLogout}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-800 text-base font-semibold text-zinc-100 shadow-sm transition touch-manipulation hover:bg-zinc-700 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <LogoutIcon />
        Wyloguj się
      </button>
    </section>
  );
}

export default PlayerProfile;

function PlayerAvatar({ name, avatarUrl, initials }: PlayerAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = avatarUrl !== null && avatarUrl.length > 0 && !imageFailed;

  return (
    <div className="flex size-20 items-center justify-center overflow-hidden rounded-full border-2 border-zinc-700 bg-zinc-800 text-xl font-semibold tracking-tight text-zinc-50">
      {showImage ? (
        <img
          src={avatarUrl}
          alt={`Awatar gracza ${name}`}
          className="size-full object-cover"
          onError={() => {
            setImageFailed(true);
          }}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </div>
  );
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-950 px-4 py-3">
      <dt className="text-sm text-zinc-400">{label}</dt>
      <dd className="text-base font-semibold text-zinc-50">{value}</dd>
    </div>
  );
}

function LogoutIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
