"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { offlineSyncMessage, syncFailureMessage } from "@/lib/client/sync-message";
import {
  MATCH_PHASES,
  type MatchPhase,
  type MatchSeatView,
  type MatchSnapshot,
} from "@/lib/game/match-types";
import { SyncStatus } from "@/components/SyncStatus";
import { useServerCountdown } from "@/components/useServerCountdown";

const POLL_INTERVAL_MS = 1000;
const EXPIRED_POLL_INTERVAL_MS = 400;

interface MatchScreenProps {
  playerId: string;
  onPhase: (phase: MatchPhase) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMatchPhase(value: unknown): value is MatchPhase {
  return typeof value === "string" && MATCH_PHASES.some((phase) => phase === value);
}

function isSeat(value: unknown): value is MatchSeatView {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.handCount === "number"
  );
}

function isNullableSeat(value: unknown): value is MatchSeatView | null {
  return value === null || isSeat(value);
}

function isMatchSnapshot(value: unknown): value is MatchSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.revision === "number" &&
    isMatchPhase(value.phase) &&
    typeof value.serverNow === "string" &&
    (value.gameId === null || typeof value.gameId === "string") &&
    isNullableSeat(value.you) &&
    isNullableSeat(value.opponent) &&
    (value.currentPlayerId === null || typeof value.currentPlayerId === "string") &&
    typeof value.isYourTurn === "boolean" &&
    (value.turnExpiresAt === null || typeof value.turnExpiresAt === "string") &&
    typeof value.remainingMs === "number" &&
    typeof value.drawPileCount === "number" &&
    (value.winnerId === null || typeof value.winnerId === "string") &&
    (value.notice === null || typeof value.notice === "string")
  );
}

class MatchRequestError extends Error {
  readonly snapshot: MatchSnapshot | null;

  constructor(message: string, snapshot: MatchSnapshot | null = null) {
    super(message);
    this.name = "MatchRequestError";
    this.snapshot = snapshot;
  }
}

function messageFromBody(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.message === "string" && value.message.trim().length > 0) {
    return value.message;
  }

  return fallback;
}

function snapshotFromBody(value: unknown): MatchSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  return isMatchSnapshot(value.snapshot) ? value.snapshot : null;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestMatch(path: string, method: "GET" | "POST"): Promise<MatchSnapshot> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (error) {
    throw new TypeError(syncFailureMessage(error));
  }

  const body = await readBody(response);
  const attached = snapshotFromBody(body);

  if (!response.ok) {
    throw new MatchRequestError(
      messageFromBody(body, "Nie udało się zsynchronizować partii. Spróbuj ponownie."),
      attached,
    );
  }

  if (!isMatchSnapshot(body)) {
    throw new Error("Nie udało się odczytać stanu partii.");
  }

  return body;
}

function secondsWord(seconds: number): string {
  if (seconds === 1) {
    return "sekunda";
  }

  const last = seconds % 10;
  const lastTwo = seconds % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return "sekundy";
  }

  return "sekund";
}

function winnerName(snapshot: MatchSnapshot): string | null {
  if (snapshot.winnerId === null) {
    return null;
  }

  if (snapshot.you?.id === snapshot.winnerId) {
    return snapshot.you.name;
  }

  if (snapshot.opponent?.id === snapshot.winnerId) {
    return snapshot.opponent.name;
  }

  return null;
}

function headingCopy(snapshot: MatchSnapshot): string {
  if (snapshot.phase === "aborted") {
    return "Partia przerwana";
  }

  if (snapshot.phase === "finished") {
    return "Partia zakończona";
  }

  return snapshot.isYourTurn ? "Twoja tura" : "Tura przeciwnika";
}

function detailCopy(snapshot: MatchSnapshot): string {
  if (snapshot.phase === "aborted") {
    return snapshot.notice ?? "Partia została przerwana. Gra nie została zapisana.";
  }

  if (snapshot.phase === "finished") {
    const name = winnerName(snapshot);
    return name === null ? "Partia została rozstrzygnięta." : `${name} wygrywa.`;
  }

  if (snapshot.isYourTurn) {
    return "Masz minutę na ruch. Po czasie układ wraca do początku tury i dobierasz kafelek.";
  }

  const name = snapshot.opponent?.name ?? "Drugi gracz";
  return `${name} ma teraz turę.`;
}

export function MatchScreen({ playerId, onPhase }: MatchScreenProps) {
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [confirmingGameId, setConfirmingGameId] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const revisionRef = useRef(0);
  const waitRef = useRef(POLL_INTERVAL_MS);

  const remainingMs = useServerCountdown(
    snapshot?.turnExpiresAt ?? null,
    snapshot?.serverNow ?? null,
    snapshot?.remainingMs ?? 0,
    snapshot?.phase === "playing",
  );
  const secondsLeft = Math.ceil(remainingMs / 1000);
  const clockExpired = snapshot?.phase === "playing" && remainingMs === 0;

  useEffect(() => {
    onPhase(snapshot?.phase ?? "idle");
  }, [onPhase, snapshot]);

  useEffect(() => {
    waitRef.current = clockExpired ? EXPIRED_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
  }, [clockExpired]);

  const applySnapshot = useCallback((next: MatchSnapshot) => {
    if (next.revision < revisionRef.current) {
      return;
    }

    revisionRef.current = next.revision;
    setSnapshot(next);
    setSyncMessage(null);
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setRetryNonce((value) => value + 1);
    };
    const onOffline = () => {
      setSyncMessage(offlineSyncMessage());
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;

    const poll = async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        if (!stopped) {
          setSyncMessage(offlineSyncMessage());
        }
      } else {
        try {
          const next = await requestMatch("/api/game", "GET");
          if (stopped) {
            return;
          }

          applySnapshot(next);
        } catch (error) {
          if (!stopped) {
            if (error instanceof MatchRequestError && error.snapshot !== null) {
              applySnapshot(error.snapshot);
            }
            setSyncMessage(syncFailureMessage(error));
          }
        }
      }

      if (!stopped) {
        timer = window.setTimeout(() => {
          void poll();
        }, waitRef.current);
      }
    };

    void poll();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [applySnapshot, playerId, retryNonce]);

  const drawTile = useCallback(async () => {
    setDrawing(true);
    setActionError(null);

    try {
      const next = await requestMatch("/api/game/draw", "POST");
      applySnapshot(next);
    } catch (error) {
      const message = syncFailureMessage(error);
      if (error instanceof MatchRequestError && error.snapshot !== null) {
        applySnapshot(error.snapshot);
        if (error.snapshot.notice !== message) {
          setActionError(message);
        }
      } else {
        setActionError(message);
      }
      if (error instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false)) {
        setSyncMessage(message);
      }
    } finally {
      setDrawing(false);
    }
  }, [applySnapshot]);

  const endMatch = useCallback(async () => {
    setEnding(true);
    setActionError(null);

    try {
      const next = await requestMatch("/api/game/end", "POST");
      applySnapshot(next);
      setConfirmingGameId(null);
    } catch (error) {
      const message = syncFailureMessage(error);
      if (error instanceof MatchRequestError && error.snapshot !== null) {
        applySnapshot(error.snapshot);
        if (error.snapshot.notice !== message) {
          setActionError(message);
        }
      } else {
        setActionError(message);
      }
      if (error instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false)) {
        setSyncMessage(message);
      }
    } finally {
      setEnding(false);
    }
  }, [applySnapshot]);

  if (snapshot === null || snapshot.phase === "idle") {
    return null;
  }

  const you = snapshot.you;
  const opponent = snapshot.opponent;
  const confirmingEnd =
    snapshot.phase === "playing" &&
    confirmingGameId !== null &&
    confirmingGameId === snapshot.gameId;

  return (
    <section
      aria-label="Stan partii"
      className="flex w-full max-w-sm flex-col gap-5 rounded-3xl border border-zinc-800 bg-zinc-900 px-6 py-6 shadow-sm select-none"
    >
      <header className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-50">
          {headingCopy(snapshot)}
        </h2>
        <p className="text-sm text-zinc-400">{detailCopy(snapshot)}</p>
      </header>

      {snapshot.phase === "playing" ? (
        <p className="text-center">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Pozostało
          </span>
          <span
            className="mt-1 block font-mono text-6xl font-semibold text-zinc-50 tabular-nums"
            aria-live="polite"
            aria-label={`${secondsLeft} ${secondsWord(secondsLeft)}`}
          >
            {secondsLeft}
          </span>
          <span className="mt-1 block text-sm text-zinc-400">{secondsWord(secondsLeft)}</span>
          {clockExpired ? (
            <span className="mt-2 block text-sm text-amber-200">
              Czas minął. Synchronizuję turę…
            </span>
          ) : null}
        </p>
      ) : null}

      {you !== null && opponent !== null ? (
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-zinc-950 px-2 py-3">
            <dt className="text-xs text-zinc-500">Twoje kafelki</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold text-zinc-50 tabular-nums">
              {you.handCount}
            </dd>
          </div>
          <div className="rounded-2xl bg-zinc-950 px-2 py-3">
            <dt className="text-xs text-zinc-500">Stos</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold text-zinc-50 tabular-nums">
              {snapshot.drawPileCount}
            </dd>
          </div>
          <div className="rounded-2xl bg-zinc-950 px-2 py-3">
            <dt className="truncate text-xs text-zinc-500">{opponent.name}</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold text-zinc-50 tabular-nums">
              {opponent.handCount}
            </dd>
          </div>
        </dl>
      ) : null}

      {snapshot.notice !== null && snapshot.phase !== "aborted" ? (
        <p className="rounded-2xl bg-zinc-950 px-4 py-3 text-center text-sm text-zinc-200" role="status">
          {snapshot.notice}
        </p>
      ) : null}

      <SyncStatus message={syncMessage} />

      {snapshot.isYourTurn && !confirmingEnd ? (
        <button
          type="button"
          disabled={drawing || ending}
          onClick={() => {
            void drawTile();
          }}
          className="flex h-14 w-full items-center justify-center rounded-2xl bg-white text-base font-semibold text-zinc-950 shadow-sm transition touch-manipulation hover:bg-zinc-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {drawing ? "Dobieranie…" : "Dobierz kafelek"}
        </button>
      ) : null}

      {snapshot.phase === "playing" && confirmingEnd ? (
        <div className="flex flex-col gap-3">
          <p className="text-center text-sm text-zinc-200">
            Na pewno zakończyć partię? Gra nie zostanie zapisana.
          </p>
          <button
            type="button"
            disabled={ending}
            onClick={() => {
              void endMatch();
            }}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-red-200 text-base font-semibold text-red-950 shadow-sm transition touch-manipulation hover:bg-red-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {ending ? "Kończenie partii…" : "Tak, zakończ"}
          </button>
          <button
            type="button"
            disabled={ending}
            onClick={() => {
              setConfirmingGameId(null);
            }}
            className="flex h-14 w-full items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-800 text-base font-semibold text-zinc-100 shadow-sm transition touch-manipulation hover:bg-zinc-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Wróć do gry
          </button>
        </div>
      ) : null}

      {snapshot.phase === "playing" && !confirmingEnd ? (
        <button
          type="button"
          disabled={drawing || ending}
          onClick={() => {
            setConfirmingGameId(snapshot.gameId);
          }}
          className="flex h-14 w-full items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-800 text-base font-semibold text-zinc-100 shadow-sm transition touch-manipulation hover:bg-zinc-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Zakończ grę
        </button>
      ) : null}

      {actionError !== null ? (
        <p role="alert" className="text-center text-sm font-medium text-red-300">
          {actionError}
        </p>
      ) : null}
    </section>
  );
}
