import type { ChatMessage } from "@/types/database";

/** Recent messages shown before the player asks for older ones. */
export const CHAT_RECENT_PAGE_SIZE = 5;

/**
 * Newest rows returned by one poll.
 * The client asks again from the newest row it received.
 */
export const CHAT_NEWER_FETCH_LIMIT = 100;

/** Points at one stored message. `id` breaks ties when `createdAt` matches. */
export interface ChatCursor {
  createdAt: string;
  id: string;
}

/**
 * `before` loads the page older than that message.
 * `after` loads messages newer than that message (live poll).
 * The two cursors are never combined.
 */
export interface ChatReadQuery {
  before?: ChatCursor;
  after?: ChatCursor;
}

export function compareChatMessages(left: ChatCursor, right: ChatCursor): number {
  if (left.createdAt === right.createdAt) {
    if (left.id === right.id) {
      return 0;
    }

    return left.id < right.id ? -1 : 1;
  }

  return left.createdAt < right.createdAt ? -1 : 1;
}

export interface ChatPage {
  messages: ChatMessage[];
  /**
   * Whether anything older than this page is still stored.
   * `null` when this response is only the forward poll and does not know.
   */
  hasOlder: boolean | null;
}

/**
 * Slices a full chronological log into one page.
 * The file backend uses this. The database backend applies the same window in SQL.
 */
export function pageChatMessages(
  messages: readonly ChatMessage[],
  query: ChatReadQuery,
  pageSize = CHAT_RECENT_PAGE_SIZE,
): ChatPage {
  const sorted = [...messages].sort(compareChatMessages);

  if (query.after) {
    const newer = sorted.filter((message) => compareChatMessages(message, query.after as ChatCursor) > 0);
    return {
      messages: newer.slice(0, CHAT_NEWER_FETCH_LIMIT),
      hasOlder: null,
    };
  }

  const olderThan = query.before
    ? sorted.filter((message) => compareChatMessages(message, query.before as ChatCursor) < 0)
    : sorted;
  const hasOlder = olderThan.length > pageSize;
  const start = Math.max(0, olderThan.length - pageSize);

  return {
    messages: olderThan.slice(start),
    hasOlder,
  };
}
