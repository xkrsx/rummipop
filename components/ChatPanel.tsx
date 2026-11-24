"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { SyncStatus } from "@/components/SyncStatus";
import { formatChatAbsoluteTime, formatChatRevealTime, formatChatTimestamp } from "@/lib/chat/format-time";
import { layoutChatBubbles } from "@/lib/chat/group";
import { compareChatMessages, type ChatCursor } from "@/lib/chat/page";
import type { ChatSnapshot } from "@/lib/chat/types";
import { offlineSyncMessage, syncFailureMessage } from "@/lib/client/sync-message";
import { validateChatText, ChatInputError } from "@/lib/chat/validate";
import type { ChatMessage } from "@/types/database";

const POLL_INTERVAL_MS = 1000;
const CLOCK_TICK_MS = 1000;
/** Width of the clock column uncovered when the whole thread slides left. */
const REVEAL_MAX_PX = 136;
const DRAG_LOCK_PX = 10;
const SPRING_STIFFNESS = 420;

function revealOffset(deltaX: number): number {
  if (deltaX >= 0) {
    return 0;
  }

  const pulled = -deltaX;
  if (pulled <= REVEAL_MAX_PX) {
    return -pulled;
  }

  return -(REVEAL_MAX_PX + (pulled - REVEAL_MAX_PX) * 0.18);
}

/** Critically damped return to rest. The offset stays at or left of zero. */
function springRevealBack(from: number, onFrame: (value: number) => void): () => void {
  if (from === 0) {
    onFrame(0);
    return () => {};
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    onFrame(0);
    return () => {};
  }

  let value = from;
  let velocity = 0;
  const damping = 2 * Math.sqrt(SPRING_STIFFNESS);
  let last = performance.now();
  let frame = 0;

  const step = (now: number) => {
    const dt = Math.min(0.034, (now - last) / 1000);
    last = now;
    velocity += (-SPRING_STIFFNESS * value - damping * velocity) * dt;
    value += velocity * dt;

    if (value >= -0.5) {
      onFrame(0);
      return;
    }

    onFrame(value);
    frame = window.requestAnimationFrame(step);
  };

  frame = window.requestAnimationFrame(step);
  return () => {
    window.cancelAnimationFrame(frame);
  };
}

function blockLabel(createdAt: string, nowMs: number | null): string {
  if (nowMs === null) {
    return formatChatAbsoluteTime(createdAt);
  }

  return formatChatTimestamp(createdAt, nowMs);
}

function revealLabel(createdAt: string, nowMs: number | null): string {
  if (nowMs === null) {
    return formatChatAbsoluteTime(createdAt);
  }

  return formatChatRevealTime(createdAt, nowMs);
}

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

  if (typeof value.hasOlder !== "boolean" && value.hasOlder !== null) {
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

function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of current) {
    byId.set(message.id, message);
  }
  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort(compareChatMessages);
}

function newestMessage(messages: readonly ChatMessage[]): ChatMessage | null {
  let newest: ChatMessage | null = null;
  for (const message of messages) {
    if (newest === null || compareChatMessages(message, newest) > 0) {
      newest = message;
    }
  }

  return newest;
}

type ChatReadCursor = { before: ChatCursor } | { after: ChatCursor };

function chatReadPath(cursor?: ChatReadCursor): string {
  if (cursor === undefined) {
    return "/api/chat";
  }

  const params = new URLSearchParams();
  if ("before" in cursor) {
    params.set("before", cursor.before.createdAt);
    params.set("beforeId", cursor.before.id);
    return `/api/chat?${params.toString()}`;
  }

  params.set("after", cursor.after.createdAt);
  params.set("afterId", cursor.after.id);
  return `/api/chat?${params.toString()}`;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestChat(method: "GET" | "POST", text?: string, cursor?: ChatReadCursor): Promise<ChatSnapshot> {
  let response: Response;
  try {
    response = await fetch(method === "GET" ? chatReadPath(cursor) : "/api/chat", {
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

type SnapshotKind = "latest" | "after" | "older" | "sent";

/**
 * Shared two-player chat. History is loaded from the server and is not cleared
 * when a match starts or the player signs out.
 * The first read is a short preview. Older rows load on request.
 * Polls ask only for messages newer than the newest contiguous row.
 */
export function ChatPanel({ playerId }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [clockNowMs, setClockNowMs] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const springStopRef = useRef<(() => void) | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    axis: "undecided" | "x" | "y";
  } | null>(null);
  const detachDragRef = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);
  const loadingOlderRef = useRef(false);
  const forwardCursorRef = useRef<ChatCursor | null>(null);
  const clockOffsetRef = useRef(0);
  const clockReadyRef = useRef(false);
  const preserveScrollRef = useRef<{ height: number; top: number } | null>(null);

  const syncClock = useCallback((serverNow: string) => {
    const serverMs = Date.parse(serverNow);
    if (Number.isNaN(serverMs)) {
      return;
    }

    clockOffsetRef.current = serverMs - Date.now();
    clockReadyRef.current = true;
    setClockNowMs(Date.now() + clockOffsetRef.current);
  }, []);

  const applySnapshot = useCallback(
    (snapshot: ChatSnapshot, kind: SnapshotKind) => {
      syncClock(snapshot.serverNow);
      setMessages((current) => mergeMessages(current, snapshot.messages));
      if (typeof snapshot.hasOlder === "boolean") {
        setHasOlder(snapshot.hasOlder);
      }

      if (kind === "latest" || kind === "after") {
        const newest = newestMessage(snapshot.messages);
        if (newest !== null) {
          forwardCursorRef.current = { createdAt: newest.createdAt, id: newest.id };
        }
      }

      setLoaded(true);
      setSyncMessage(null);
    },
    [syncClock],
  );

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
          const cursor = forwardCursorRef.current;
          const snapshot = await requestChat("GET", undefined, cursor === null ? undefined : { after: cursor });
          if (stopped) {
            return;
          }

          applySnapshot(snapshot, cursor === null ? "latest" : "after");
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

  useEffect(() => {
    const tick = () => {
      if (!clockReadyRef.current) {
        return;
      }

      setClockNowMs(Date.now() + clockOffsetRef.current);
    };
    const timer = window.setInterval(tick, CLOCK_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (oldest === undefined || !hasOlder || loadingOlderRef.current) {
      return;
    }

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setOlderError(null);

    try {
      const snapshot = await requestChat("GET", undefined, {
        before: { createdAt: oldest.createdAt, id: oldest.id },
      });
      const list = listRef.current;
      if (list !== null) {
        preserveScrollRef.current = { height: list.scrollHeight, top: list.scrollTop };
      }
      applySnapshot(snapshot, "older");
    } catch (error) {
      preserveScrollRef.current = null;
      setOlderError(syncFailureMessage(error));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [applySnapshot, hasOlder, messages]);

  const lastMessageId = messages[messages.length - 1]?.id ?? "";

  useEffect(() => {
    const list = listRef.current;
    if (list === null) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, [lastMessageId]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const preserve = preserveScrollRef.current;
    if (list === null || preserve === null) {
      return;
    }

    preserveScrollRef.current = null;
    list.scrollTop = preserve.top + (list.scrollHeight - preserve.height);
  }, [messages]);

  const paintOffset = useCallback((value: number) => {
    offsetRef.current = value;
    const list = listRef.current;
    if (list === null) {
      return;
    }

    const progress = Math.min(1, -value / 36);
    const track = list.querySelector<HTMLElement>("[data-chat-track]");
    if (track !== null) {
      track.style.transform = `translate3d(${value}px,0,0)`;
    }
    const stamp = `translate3d(${-value + (1 - progress) * 10}px,-50%,0)`;
    for (const node of list.querySelectorAll<HTMLElement>("[data-chat-stamp]")) {
      node.style.transform = stamp;
      node.style.opacity = String(progress);
    }
  }, []);

  useLayoutEffect(() => {
    paintOffset(offsetRef.current);
  });

  useEffect(() => {
    return () => {
      detachDragRef.current?.();
      springStopRef.current?.();
    };
  }, []);

  const stopSpring = useCallback(() => {
    springStopRef.current?.();
    springStopRef.current = null;
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (list === null) {
      return;
    }

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      stopSpring();
      detachDragRef.current?.();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        axis: "undecided",
      };

      const onMove = (move: PointerEvent) => {
        const drag = dragRef.current;
        if (drag === null || drag.pointerId !== move.pointerId) {
          return;
        }

        const deltaX = move.clientX - drag.startX;
        const deltaY = move.clientY - drag.startY;
        if (drag.axis === "undecided") {
          if (Math.abs(deltaX) < DRAG_LOCK_PX && Math.abs(deltaY) < DRAG_LOCK_PX) {
            return;
          }

          drag.axis = Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
          if (drag.axis !== "x") {
            return;
          }

          list.classList.add("select-none");
          window.getSelection()?.removeAllRanges();
          setDragging(true);
          try {
            list.setPointerCapture(move.pointerId);
          } catch {
            // Capture is optional. Window listeners still follow the pointer.
          }
        }

        if (drag.axis !== "x") {
          return;
        }

        if (move.cancelable) {
          move.preventDefault();
        }
        paintOffset(revealOffset(deltaX));
      };

      const onTouchMove = (touch: TouchEvent) => {
        if (dragRef.current?.axis === "x" && touch.cancelable) {
          touch.preventDefault();
        }
      };

      const endGesture = (endEvent: Event) => {
        const drag = dragRef.current;
        if (drag === null) {
          return;
        }

        if (endEvent instanceof PointerEvent && endEvent.pointerId !== drag.pointerId) {
          return;
        }

        const horizontal = drag.axis === "x";
        dragRef.current = null;
        detach();
        list.classList.remove("select-none");
        setDragging(false);
        if (!horizontal) {
          return;
        }

        springStopRef.current = springRevealBack(offsetRef.current, paintOffset);
        const suppressClick = (click: MouseEvent) => {
          click.preventDefault();
          click.stopPropagation();
        };
        window.addEventListener("click", suppressClick, true);
        window.setTimeout(() => {
          window.removeEventListener("click", suppressClick, true);
        }, 0);
      };

      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", endGesture);
        window.removeEventListener("pointercancel", endGesture);
        list.removeEventListener("touchmove", onTouchMove);
        list.removeEventListener("touchend", endGesture);
        list.removeEventListener("touchcancel", endGesture);
        detachDragRef.current = null;
      };

      detachDragRef.current = detach;
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", endGesture);
      window.addEventListener("pointercancel", endGesture);
      list.addEventListener("touchmove", onTouchMove, { passive: false });
      list.addEventListener("touchend", endGesture);
      list.addEventListener("touchcancel", endGesture);
    };

    list.addEventListener("pointerdown", onDown, true);
    return () => {
      list.removeEventListener("pointerdown", onDown, true);
      detachDragRef.current?.();
    };
  }, [paintOffset, stopSpring]);

  const layouts = useMemo(() => layoutChatBubbles(messages), [messages]);

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
      applySnapshot(snapshot, "sent");
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
        className={
          dragging
            ? "chat-thread flex max-h-80 min-h-40 touch-pan-y flex-col overflow-x-hidden overflow-y-auto rounded-2xl bg-zinc-950 px-3 py-3 select-none [&_*]:touch-pan-y"
            : "chat-thread flex max-h-80 min-h-40 touch-pan-y flex-col overflow-x-hidden overflow-y-auto rounded-2xl bg-zinc-950 px-3 py-3 [&_*]:touch-pan-y"
        }
      >
        {hasOlder ? (
          <button
            type="button"
            onClick={() => {
              void loadOlder();
            }}
            disabled={loadingOlder}
            className="flex h-10 w-full items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-900 px-3 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {loadingOlder ? "Wczytywanie…" : "Wczytaj starsze wiadomości"}
          </button>
        ) : null}
        {olderError !== null ? (
          <p role="alert" className="text-center text-sm font-medium text-red-300">
            {olderError}
          </p>
        ) : null}
        {!loaded && syncMessage === null ? (
          <p className="m-auto text-center text-sm text-zinc-400">Wczytywanie czatu…</p>
        ) : null}
        {loaded && messages.length === 0 ? (
          <p className="m-auto text-center text-sm text-zinc-400">Brak wiadomości. Napisz pierwszą.</p>
        ) : null}
        <div data-chat-track="" className="flex w-full flex-1 flex-col" style={{ transform: "translate3d(0px,0,0)" }}>
          {messages.map((message, index) => {
            const layout = layouts[index];
            const mine = message.senderId === playerId;
            const exact = revealLabel(message.createdAt, clockNowMs);
            const rowSpacing =
              layout === undefined || layout.startsTimeBlock ? "" : layout.continuesSpeaker ? "mt-0.5" : "mt-2.5";

            return (
              <div key={message.id} className="w-full">
                {layout?.startsTimeBlock ? (
                  <div className={index === 0 ? "mb-1.5 flex items-center gap-2" : "mt-3 mb-1.5 flex items-center gap-2"}>
                    <span aria-hidden="true" className="h-px flex-1 bg-zinc-800" />
                    <time dateTime={message.createdAt} className="shrink-0 text-xs text-zinc-500">
                      {blockLabel(message.createdAt, clockNowMs)}
                    </time>
                    <span aria-hidden="true" className="h-px flex-1 bg-zinc-800" />
                  </div>
                ) : null}
                <div className={rowSpacing === "" ? "relative w-full" : `relative w-full ${rowSpacing}`}>
                  <article
                    aria-label={mine ? `Twoja wiadomość, ${exact}` : `Wiadomość od ${message.senderName}, ${exact}`}
                    className={
                      mine
                        ? "relative z-10 ml-auto flex w-fit max-w-[85%] flex-col items-end"
                        : "relative z-10 mr-auto flex w-fit max-w-[85%] flex-col items-start"
                    }
                  >
                    <p
                      title={exact}
                      className={
                        mine
                          ? "rounded-2xl bg-white px-3 py-2 text-sm break-words whitespace-pre-wrap text-zinc-950"
                          : "rounded-2xl bg-zinc-800 px-3 py-2 text-sm break-words whitespace-pre-wrap text-zinc-50"
                      }
                    >
                      {message.text}
                    </p>
                  </article>
                  <time
                    data-chat-stamp=""
                    dateTime={message.createdAt}
                    aria-hidden="true"
                    style={{ transform: "translate3d(10px,-50%,0)", opacity: 0 }}
                    className="pointer-events-none absolute top-1/2 right-0 z-0 pr-1 text-xs whitespace-nowrap text-zinc-400 tabular-nums"
                  >
                    {exact}
                  </time>
                </div>
              </div>
            );
          })}
          <div aria-hidden="true" className="min-h-6 w-full flex-1" />
        </div>
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
