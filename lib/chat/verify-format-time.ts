/**
 * Checks Polish relative chat times against a fixed server clock.
 * Run with: npx tsx lib/chat/verify-format-time.ts
 */

import assert from "node:assert/strict";

import { formatChatAbsoluteTime, formatChatRevealTime, formatChatTimestamp } from "./format-time";

let assertions = 0;

function expectEqual(actual: string, expected: string, message: string): void {
  assertions += 1;
  assert.equal(actual, expected, message);
}

const now = Date.parse("2026-11-24T12:00:00.000Z");

function ago(seconds: number): string {
  return new Date(now - seconds * 1000).toISOString();
}

expectEqual(formatChatTimestamp(ago(0), now), "przed chwilą", "a message from this moment is just now");
expectEqual(formatChatTimestamp(ago(9), now), "przed chwilą", "under ten seconds stays just now");
expectEqual(formatChatTimestamp(ago(-5), now), "przed chwilą", "a clock skew into the future stays just now");
expectEqual(formatChatTimestamp(ago(10), now), "10 sekund temu", "ten seconds uses the plural");
expectEqual(formatChatTimestamp(ago(1), now), "przed chwilą", "one second is still just now");
expectEqual(formatChatTimestamp(ago(22), now), "22 sekundy temu", "22 uses the few form");
expectEqual(formatChatTimestamp(ago(12), now), "12 sekund temu", "the teens use the many form");
expectEqual(formatChatTimestamp(ago(21), now), "21 sekund temu", "21 does not use the singular");
expectEqual(formatChatTimestamp(ago(60), now), "1 minutę temu", "one minute uses the singular");
expectEqual(formatChatTimestamp(ago(2 * 60), now), "2 minuty temu", "two minutes use the few form");
expectEqual(formatChatTimestamp(ago(5 * 60), now), "5 minut temu", "five minutes use the many form");
expectEqual(formatChatTimestamp(ago(22 * 60), now), "22 minuty temu", "22 minutes use the few form");
expectEqual(formatChatTimestamp(ago(59 * 60), now), "59 minut temu", "the last minute of the hour stays relative");
expectEqual(formatChatTimestamp(ago(60 * 60), now), "12:00", "an hour ago today is the Warsaw clock");
expectEqual(formatChatTimestamp(ago(2 * 60 * 60), now), "11:00", "earlier today is HH:MM");
expectEqual(formatChatTimestamp("2026-11-23T12:00:00.000Z", now), "23.11.2026 13:00", "a previous day includes the date");
expectEqual(
  formatChatTimestamp("2026-11-23T22:50:00.000Z", Date.parse("2026-11-23T23:10:00.000Z")),
  "20 minut temu",
  "a recent message keeps minutes even across Warsaw midnight",
);
expectEqual(formatChatAbsoluteTime("2026-11-24T08:05:00.000Z"), "24.11.2026 09:05", "the tooltip is the Warsaw date and clock");
expectEqual(formatChatTimestamp("not-a-time", now), "not-a-time", "an unreadable timestamp is left unchanged");
expectEqual(formatChatRevealTime(ago(2 * 60 * 60), now), "11:00", "a reveal on the same Warsaw day is HH:MM");
expectEqual(formatChatRevealTime(ago(30), now), "12:59", "a reveal stays on the clock even when the label is still relative");
expectEqual(
  formatChatRevealTime("2026-11-23T22:30:00.000Z", now),
  "23.11.2026 23:30",
  "a reveal from an earlier Warsaw day includes the date",
);
expectEqual(
  formatChatRevealTime("2026-11-23T23:30:00.000Z", now),
  "00:30",
  "just after Warsaw midnight is still today's clock",
);
expectEqual(formatChatRevealTime("not-a-time", now), "not-a-time", "an unreadable reveal time is left unchanged");

console.log(`chat time: ${assertions} checks passed`);
