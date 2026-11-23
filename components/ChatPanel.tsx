"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { SyncStatus } from "@/components/SyncStatus";
import type { ChatSnapshot } from "@/lib/chat/types";
import { offlineSyncMessage, syncFailureMessage } from "@/lib/client/sync-message";
import { validateChatText, ChatInputError } from "@/lib/chat/validate";
import type { ChatMessage } from "@/types/database";

const POLL_INTERVAL_MS = 1000;

interface ChatPanelProps {
  playerId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.senderId === "string" &&
    typeof value.senderName === "string" &&
    typeof value.text === "string" &&
    typeof value.createdAt === "string"
  );
}

function isChatSnapshot(value: unknown): value is ChatSnapshot {
  if (!isRecord(value) || !Array.isArray(value.messages) || typeof value.serverNow !== "string") {
    return false;
  }

  return value.messages.every((message) => isChatMessage(message));
}

function messageFromBody(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.message === "string" && value.message.trim().length > 0) {
    return value.message;
  }

  return fallback;
}

function compareMessages(left: ChatMessage, right: ChatMessage): number {
  if (left.createdAt === right.createdAt) {
    if (left.id === right.id) {
      return 0;
    }

    return left.id < right.id ? -1 : 1;
  }

  return left.createdAt < right.createdAt ? -1 : 1;
}

function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of current) {
    byId.set(message.id, message);
  }
  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort(compareMessages);
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestChat(method: "GET" | "POST", text?: string): Promise<ChatSnapshot> {
  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method,
      headers: {
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify({ text }) : undefined,
      cache: "no-store",
    });
  } catch (error) {
    throw new TypeError(syncFailureMessage(error));
  }

  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(messageFromBody(body, "Nie udało się zsynchronizować czatu. Spróbuj ponownie."));
  }

  if (!isChatSnapshot(body)) {
    throw new Error("Nie udało się odczytać czatu.");
  }

  return body;
}

function formatCreatedAt(createdAt: string, timeFormat: Intl.DateTimeFormat): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return createdAt;
  }

  return timeFormat.format(date);
}

/**
 * Shared two-player chat. History is loaded from the server and is not cleared
 * when a match starts or the player signs out.
 */
export function ChatPanel({ playerId }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat("pl-PL", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    [],
  );

  const applySnapshot = useCallback((snapshot: ChatSnapshot) => {
    setMessages((current) => mergeMessages(current, snapshot.messages));
    setLoaded(true);
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
          const snapshot = await requestChat("GET");
          if (stopped) {
            return;
          }

          applySnapshot(snapshot);
        } catch (error) {
          if (!stopped) {
            setSyncMessage(syncFailureMessage(error));
          }
        }
      }

      if (!stopped) {
        timer = window.setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [applySnapshot, playerId, retryNonce]);

  const lastMessageId = messages[messages.length - 1]?.id ?? "";

  useEffect(() => {
    const list = listRef.current;
    if (list === null) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, [lastMessageId]);

  const sendMessage = useCallback(async () => {
    let text: string;
    try {
      text = validateChatText(draft);
    } catch (error) {
      setFormError(error instanceof ChatInputError ? error.message : "Wpisz wiadomość.");
      return;
    }

    setSending(true);
    setFormError(null);

    try {
      const snapshot = await requestChat("POST", text);
      applySnapshot(snapshot);
      setDraft("");
    } catch (error) {
      setFormError(syncFailureMessage(error));
      if (error instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false)) {
        setSyncMessage(syncFailureMessage(error));
      }
    } finally {
      setSending(false);
    }
  }, [applySnapshot, draft]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  };

  return (
    <section
      aria-label="Czat"
      className="flex w-full max-w-sm flex-col gap-4 rounded-3xl border border-zinc-800 bg-zinc-900 px-6 py-6 shadow-sm"
    >
      <header className="flex flex-col gap-1 text-center">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-50">Czat</h2>
        <p className="text-sm text-zinc-400">Wiadomości zostają po nowej partii i po wylogowaniu.</p>
      </header>

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="flex max-h-80 min-h-40 flex-col gap-3 overflow-y-auto rounded-2xl bg-zinc-950 px-3 py-3"
      >
        {!loaded && syncMessage === null ? (
          <p className="m-auto text-center text-sm text-zinc-400">Wczytywanie czatu…</p>
        ) : null}
        {loaded && messages.length === 0 ? (
          <p className="m-auto text-center text-sm text-zinc-400">Brak wiadomości. Napisz pierwszą.</p>
        ) : null}
        {messages.map((message) => {
          const mine = message.senderId === playerId;
          return (
            <article
              key={message.id}
              aria-label={mine ? "Twoja wiadomość" : `Wiadomość od ${message.senderName}`}
              className={mine ? "flex max-w-[85%] flex-col items-end self-end" : "flex max-w-[85%] flex-col items-start self-start"}
            >
              <p className="px-1 text-xs text-zinc-500">{mine ? "Ty" : message.senderName}</p>
              <p
                className={
                  mine
                    ? "rounded-2xl bg-white px-3 py-2 text-sm break-words whitespace-pre-wrap text-zinc-950"
                    : "rounded-2xl bg-zinc-800 px-3 py-2 text-sm break-words whitespace-pre-wrap text-zinc-50"
                }
              >
                {message.text}
              </p>
              <time dateTime={message.createdAt} className="px-1 pt-1 text-xs text-zinc-500">
                {formatCreatedAt(message.createdAt, timeFormat)}
              </time>
            </article>
          );
        })}
      </div>

      <SyncStatus message={syncMessage} />

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label htmlFor="chat-text" className="sr-only">
          Wiadomość
        </label>
        <textarea
          id="chat-text"
          name="text"
          rows={2}
          value={draft}
          disabled={sending}
          placeholder="Napisz wiadomość"
          onChange={(event) => {
            setDraft(event.target.value);
            setFormError(null);
          }}
          onKeyDown={onKeyDown}
          className="min-h-14 w-full resize-none rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-base text-zinc-50 outline-none placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={sending}
          className="flex h-14 w-full items-center justify-center rounded-2xl bg-white text-base font-semibold text-zinc-950 shadow-sm transition touch-manipulation hover:bg-zinc-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {sending ? "Wysyłanie…" : "Wyślij"}
        </button>
      </form>

      {formError !== null ? (
        <p role="alert" className="text-center text-sm font-medium text-red-300">
          {formError}
        </p>
      ) : null}
    </section>
  );
}
