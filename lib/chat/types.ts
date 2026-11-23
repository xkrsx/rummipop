import type { ChatMessage } from "@/types/database";

/** Chat thread returned by a poll or a successful send. */
export interface ChatSnapshot {
  messages: ChatMessage[];
  serverNow: string;
}
