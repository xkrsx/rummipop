/**
 * Checks chat text rules: trim, empty, and the length cap.
 * Run with: npx tsx lib/chat/verify-validate.ts
 */

import assert from "node:assert/strict";

import {
  ChatInputError,
  EMPTY_CHAT_MESSAGE,
  LONG_CHAT_MESSAGE,
  MAX_CHAT_TEXT_LENGTH,
  validateChatText,
} from "./validate";

let assertions = 0;

function expectEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.strictEqual(actual, expected, message);
}

function expectThrow(run: () => void, expected: string, message: string): void {
  assertions += 1;
  assert.throws(run, (error: unknown) => {
    return error instanceof ChatInputError && error.message === expected;
  }, message);
}

expectEqual(validateChatText("  cześć  "), "cześć", "surrounding spaces are removed");
expectEqual(validateChatText("linia\ndruga"), "linia\ndruga", "a line break inside the message stays");

expectThrow(() => validateChatText(""), EMPTY_CHAT_MESSAGE, "an empty string is rejected");
expectThrow(() => validateChatText("   \n\t  "), EMPTY_CHAT_MESSAGE, "whitespace alone is rejected");
expectThrow(() => validateChatText(null), EMPTY_CHAT_MESSAGE, "a missing value is rejected");
expectThrow(() => validateChatText(12), EMPTY_CHAT_MESSAGE, "a non-string is rejected");

const limit = "ą".repeat(MAX_CHAT_TEXT_LENGTH);
expectEqual(validateChatText(limit), limit, "a message at the limit is kept");
expectThrow(
  () => validateChatText(`${limit}!`),
  LONG_CHAT_MESSAGE,
  "one character over the limit is rejected",
);
expectThrow(
  () => validateChatText("👍".repeat(MAX_CHAT_TEXT_LENGTH + 1)),
  LONG_CHAT_MESSAGE,
  "the limit counts code points, not UTF-16 units",
);

console.log(`Chat validation passed (${assertions} assertions).`);
