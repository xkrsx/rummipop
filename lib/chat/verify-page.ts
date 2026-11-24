/**
 * Checks recent-page and older-page windows, including equal timestamps.
 * Run with: npx tsx lib/chat/verify-page.ts
 */

import assert from "node:assert/strict";

import { CHAT_RECENT_PAGE_SIZE, pageChatMessages, type ChatCursor } from "./page";
import type { ChatMessage } from "../../types/database";

let assertions = 0;

function expectEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

function message(id: string, createdAt: string): ChatMessage {
  return {
    id,
    senderId: "anna",
    senderName: "Anna",
    text: id,
    createdAt,
  };
}

function ids(page: { messages: ChatMessage[] }): string[] {
  return page.messages.map((entry) => entry.id);
}

function cursor(entry: ChatMessage): ChatCursor {
  return { createdAt: entry.createdAt, id: entry.id };
}

const thread = [
  message("a", "2026-11-24T10:00:00.000Z"),
  message("b", "2026-11-24T10:01:00.000Z"),
  message("c", "2026-11-24T10:02:00.000Z"),
  message("d", "2026-11-24T10:03:00.000Z"),
  message("e", "2026-11-24T10:04:00.000Z"),
  message("f", "2026-11-24T10:05:00.000Z"),
  message("g", "2026-11-24T10:06:00.000Z"),
];

const recent = pageChatMessages(thread, {});
expectEqual(ids(recent), ["c", "d", "e", "f", "g"], "the preview is the last five messages, oldest first");
expectEqual(recent.hasOlder, true, "older history is available behind the preview");

const older = pageChatMessages(thread, { before: cursor(recent.messages[0] as ChatMessage) });
expectEqual(ids(older), ["a", "b"], "the next older page keeps chronological order");
expectEqual(older.hasOlder, false, "the older page reports when history is exhausted");

const exact = pageChatMessages(thread.slice(0, CHAT_RECENT_PAGE_SIZE), {});
expectEqual(ids(exact), ["a", "b", "c", "d", "e"], "a thread that fits the preview is returned whole");
expectEqual(exact.hasOlder, false, "a thread that fits the preview has no older page");

const tied = [
  message("m", "2026-11-24T12:00:00.000Z"),
  message("n", "2026-11-24T12:00:00.000Z"),
  message("o", "2026-11-24T12:00:00.000Z"),
];
const tiedPage = pageChatMessages([...tied].reverse(), {}, 2);
expectEqual(ids(tiedPage), ["n", "o"], "equal timestamps break ties by id");
expectEqual(tiedPage.hasOlder, true, "a tied timestamp still paginates");

const beforeTie = pageChatMessages(tied, { before: cursor(tied[2] as ChatMessage) }, 2);
expectEqual(ids(beforeTie), ["m", "n"], "the older page excludes the cursor when timestamps match");

const afterTie = pageChatMessages(tied, { after: cursor(tied[0] as ChatMessage) });
expectEqual(ids(afterTie), ["n", "o"], "a forward poll returns only newer rows");
expectEqual(afterTie.hasOlder, null, "a forward poll does not change the older-history flag");

const caughtUp = pageChatMessages(thread, { after: cursor(thread[6] as ChatMessage) });
expectEqual(ids(caughtUp), [], "a poll at the newest row is empty");
expectEqual(caughtUp.hasOlder, null, "an empty poll still leaves the older-history flag unset");

console.log(`chat page: ${assertions} checks passed`);
