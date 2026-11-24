/**
 * Checks five-minute chat time blocks and same-speaker clustering.
 * Run with: npx tsx lib/chat/verify-group.ts
 */

import assert from "node:assert/strict";

import { CHAT_TIME_BLOCK_GAP_MS, layoutChatBubbles } from "./group";

let assertions = 0;

function expectEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

const anna = "anna";
const bartek = "bartek";
const start = Date.parse("2026-11-24T12:00:00.000Z");

function at(offsetMs: number): string {
  return new Date(start + offsetMs).toISOString();
}

expectEqual(layoutChatBubbles([]), [], "an empty thread has no rows");

expectEqual(
  layoutChatBubbles([{ senderId: anna, createdAt: at(0) }]),
  [{ startsTimeBlock: true, continuesSpeaker: false }],
  "the first message opens a time block",
);

expectEqual(
  layoutChatBubbles([
    { senderId: anna, createdAt: at(0) },
    { senderId: anna, createdAt: at(60 * 1000) },
  ]),
  [
    { startsTimeBlock: true, continuesSpeaker: false },
    { startsTimeBlock: false, continuesSpeaker: true },
  ],
  "a same-sender reply inside five minutes stays in the block and tightens",
);

expectEqual(
  layoutChatBubbles([
    { senderId: anna, createdAt: at(0) },
    { senderId: bartek, createdAt: at(CHAT_TIME_BLOCK_GAP_MS) },
  ]),
  [
    { startsTimeBlock: true, continuesSpeaker: false },
    { startsTimeBlock: false, continuesSpeaker: false },
  ],
  "a gap of exactly five minutes stays in the block, with a speaker change",
);

expectEqual(
  layoutChatBubbles([
    { senderId: anna, createdAt: at(0) },
    { senderId: anna, createdAt: at(CHAT_TIME_BLOCK_GAP_MS + 1) },
  ]),
  [
    { startsTimeBlock: true, continuesSpeaker: false },
    { startsTimeBlock: true, continuesSpeaker: false },
  ],
  "a gap past five minutes opens a new block even for the same sender",
);

expectEqual(
  layoutChatBubbles([
    { senderId: anna, createdAt: at(0) },
    { senderId: bartek, createdAt: at(4 * 60 * 1000) },
    { senderId: anna, createdAt: at(8 * 60 * 1000) },
  ]),
  [
    { startsTimeBlock: true, continuesSpeaker: false },
    { startsTimeBlock: false, continuesSpeaker: false },
    { startsTimeBlock: false, continuesSpeaker: false },
  ],
  "the gap is measured from the previous message, not the block start",
);

expectEqual(
  layoutChatBubbles([
    { senderId: anna, createdAt: at(0) },
    { senderId: bartek, createdAt: "not-a-time" },
  ]),
  [
    { startsTimeBlock: true, continuesSpeaker: false },
    { startsTimeBlock: true, continuesSpeaker: false },
  ],
  "an unreadable timestamp opens its own block",
);

console.log(`chat grouping: ${assertions} checks passed`);
