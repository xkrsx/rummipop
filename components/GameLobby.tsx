"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  INVITE_STATUSES,
  type InviteParticipant,
  type InviteRole,
  type InviteSnapshot,
  type InviteStatus,
} from "@/lib/invite/types";

const POLL_INTERVAL_MS = 1000;
const CLOCK_INTERVAL_MS = 200;

type LobbyAction = "open" | "accept" | "cancel";

const ACTION_PATH: Record<LobbyAction, string> = {
  open: "/api/invite",
  accept: "/api/invite/accept",
  cancel: "/api/invite/cancel",
};

interface GameLobbyProps {
  playerId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInviteStatus(value: unknown): value is InviteStatus {
  return typeof value === "string" && INVITE_STATUSES.some((status) => status === value);
}

function isInviteRole(value: unknown): value is InviteRole {
  return value === "host" || value === "opponent" || value === "none";
}

function isParticipant(value: unknown): value is InviteParticipant {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.avatarUrl === null || typeof value.avatarUrl === "string")
  );
}

function isNullableParticipant(value: unknown): value is InviteParticipant | null {
  return value === null || isParticipant(value);
}

function isInviteSnapshot(value: unknown): value is InviteSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.revision === "number" &&
    isInviteStatus(value.status) &&
    isInviteRole(value.role) &&
    typeof value.serverNow === "string" &&
    (value.expiresAt === null || typeof value.expiresAt === "string") &&
    typeof value.remainingMs === "number" &&
    isNullableParticipant(value.host) &&
    isNullableParticipant(value.opponent) &&
    (value.confirmedAt === null || typeof value.confirmedAt === "string")
  );
}

function messageFromBody(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.message === "string" && value.message.trim().length > 0) {
    return value.message;
  }

  return fallback;
}

async function requestInvite(path: string, method: "GET" | "POST"): Promise<InviteSnapshot> {
  const response = await fetch(path, {
    method,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(
      messageFromBody(body, "Nie udało się zaktualizować zaproszenia. Spróbuj ponownie."),
    );
  }

  if (!isInviteSnapshot(body)) {
    throw new Error("Nie udało się odczytać stanu zaproszenia.");
  }

  return body;
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${seconds.toString().padStart(2, "0")}`;
}

function statusCopy(snapshot: InviteSnapshot): string {
  switch (snapshot.status) {
    case "idle":
      return "Zaproś drugiego gracza. Na potwierdzenie gotowości jest 90 sekund.";
    case "waiting_for_opponent":
      return snapshot.role === "host"
        ? "Czekamy na potwierdzenie drugiego gracza."
        : `${snapshot.host?.name ?? "Drugi gracz"} zaprasza Cię do partii.`;
    case "confirmed_ready":
      return "Obaj gracze potwierdzili gotowość. Gra się zaczyna.";
    case "expired":
      return "Czas na potwierdzenie minął. Zaproszenie wygasło.";
    case "cancelled":
      return "Zaproszenie zostało anulowane. Możesz wysłać nowe.";
  }
}

function headingCopy(snapshot: InviteSnapshot | null): string {
  if (snapshot === null) {
    return "Partia dla dwóch graczy";
  }

  switch (snapshot.status) {
    case "waiting_for_opponent":
      return snapshot.role === "host" ? "Zaproszenie wysłane" : "Nowe zaproszenie";
    case "confirmed_ready":
      return "Gotowi do gry";
    case "expired":
      return "Zaproszenie wygasło";
    case "cancelled":
      return "Zaproszenie anulowane";
    case "idle":
      return "Partia dla dwóch graczy";
  }
}

/**
 * Local countdown corrected by the latest server clock.
 * The server still decides when the invitation expires.
 */
function useRemainingMs(snapshot: InviteSnapshot | null): number {
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    if (snapshot === null || snapshot.status !== "waiting_for_opponent" || snapshot.expiresAt === null) {
      setRemainingMs(0);
      return;
    }

    const expiresAtMs = Date.parse(snapshot.expiresAt);
    const serverNowMs = Date.parse(snapshot.serverNow);
    if (Number.isNaN(expiresAtMs) || Number.isNaN(serverNowMs)) {
      setRemainingMs(snapshot.remainingMs);
      return;
    }

    const clockOffset = serverNowMs - Date.now();

    const update = () => {
      setRemainingMs(Math.max(0, expiresAtMs - (Date.now() + clockOffset)));
    };

    update();
    const timer = window.setInterval(update, CLOCK_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [snapshot]);

  return remainingMs;
}

export function GameLobby({ playerId }: GameLobbyProps) {
  const [snapshot, setSnapshot] = useState<InviteSnapshot | null>(null);
  const [pendingAction, setPendingAction] = useState<LobbyAction | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const revisionRef = useRef(0);
  const remainingMs = useRemainingMs(snapshot);

  const applySnapshot = useCallback((next: InviteSnapshot) => {
    if (next.revision < revisionRef.current) {
      return;
    }

    revisionRef.current = next.revision;
    setSnapshot((current) => {
      if (
        current !== null &&
        next.revision === current.revision &&
        next.status === current.status &&
        next.role === current.role &&
        next.expiresAt === current.expiresAt &&
        next.confirmedAt === current.confirmedAt &&
        next.host?.id === current.host?.id &&
        next.opponent?.id === current.opponent?.id
      ) {
        return current;
      }

      return next;
    });
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;

    const poll = async () => {
      try {
        const next = await requestInvite("/api/invite", "GET");
        if (stopped) {
          return;
        }

        applySnapshot(next);
      } catch (error) {
        if (!stopped) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Nie udało się odczytać stanu zaproszenia.",
          );
        }
      } finally {
        if (!stopped) {
          timer = window.setTimeout(() => {
            void poll();
          }, POLL_INTERVAL_MS);
        }
      }
    };

    void poll();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [applySnapshot, playerId]);

  const runAction = useCallback(async (action: LobbyAction) => {
    setPendingAction(action);
    setErrorMessage(null);

    try {
      const next = await requestInvite(ACTION_PATH[action], "POST");
      applySnapshot(next);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Nie udało się zaktualizować zaproszenia. Spróbuj ponownie.",
      );
    } finally {
      setPendingAction(null);
    }
  }, [applySnapshot]);

  const status = snapshot?.status ?? "idle";
  const role = snapshot?.role ?? "none";
  const waitingTimedOut = status === "waiting_for_opponent" && remainingMs === 0;
  const loading = snapshot === null && errorMessage === null;
  const busy = pendingAction !== null || loading;
  const canOpen =
    status === "idle" || status === "expired" || status === "cancelled";
  const canAccept = status === "waiting_for_opponent" && role === "opponent" && !waitingTimedOut;
  const canCancel = status === "waiting_for_opponent" || status === "confirmed_ready";

  return (
    <section
      aria-label="Zaproszenie do partii"
      className="flex w-full max-w-sm flex-col gap-5 rounded-3xl border border-zinc-800 bg-zinc-900 px-6 py-6 shadow-sm select-none"
    >
      <header className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-50">
          {headingCopy(snapshot)}
        </h2>
        <p className="text-sm text-zinc-400" aria-live="polite">
          {snapshot === null ? "Sprawdzanie zaproszenia…" : statusCopy(snapshot)}
        </p>
      </header>

      {status === "waiting_for_opponent" ? (
        <p className="text-center">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Pozostało
          </span>
          <span
            className="mt-1 block font-mono text-4xl font-semibold text-zinc-50 tabular-nums"
            aria-live="polite"
          >
            {formatCountdown(remainingMs)}
          </span>
          {waitingTimedOut ? (
            <span className="mt-2 block text-sm text-amber-200">
              Czas minął. Sprawdzamy zaproszenie…
            </span>
          ) : null}
        </p>
      ) : null}

      {snapshot !== null &&
      snapshot.status === "confirmed_ready" &&
      snapshot.host !== null &&
      snapshot.opponent !== null ? (
        <p className="rounded-2xl bg-zinc-950 px-4 py-3 text-center text-sm text-zinc-300">
          <span className="font-semibold text-zinc-50">{snapshot.host.name}</span>
          {" i "}
          <span className="font-semibold text-zinc-50">{snapshot.opponent.name}</span>
          {" są przy stole."}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {canOpen ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void runAction("open");
            }}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-white text-base font-semibold text-zinc-950 shadow-sm transition touch-manipulation hover:bg-zinc-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {pendingAction === "open"
              ? "Wysyłanie zaproszenia…"
              : status === "expired"
                ? "Zaproś ponownie"
                : "Zaproś do gry"}
          </button>
        ) : null}

        {canAccept ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void runAction("accept");
            }}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-white text-base font-semibold text-zinc-950 shadow-sm transition touch-manipulation hover:bg-zinc-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {pendingAction === "accept" ? "Potwierdzanie…" : "Potwierdź gotowość"}
          </button>
        ) : null}

        {canCancel ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void runAction("cancel");
            }}
            className="flex h-14 w-full items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-800 text-base font-semibold text-zinc-100 shadow-sm transition touch-manipulation hover:bg-zinc-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {pendingAction === "cancel"
              ? "Anulowanie…"
              : status === "confirmed_ready"
                ? "Wróć do poczekalni"
                : role === "opponent"
                  ? "Odrzuć zaproszenie"
                  : "Anuluj zaproszenie"}
          </button>
        ) : null}
      </div>

      {errorMessage !== null ? (
        <p role="alert" className="text-center text-sm font-medium text-red-300">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
