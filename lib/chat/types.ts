import type { ChatMessage } from "@/types/database";

/**
 * One chat response: a recent page, an older page, or messages newer than a poll cursor.
 * `serverNow` is the clock used for relative timestamps.
 */
export interface ChatSnapshot {
  messages: ChatMessage[];
  serverNow: string;
  /**
   * True when rows older than this page are still stored.
   * Null for a forward poll or a send, which do not change that fact.
   */
  hasOlder: boolean | null;
}
