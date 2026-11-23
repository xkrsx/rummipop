/**
 * Checks that logout cancels only an invitation that has not been accepted.
 * Run with: npx tsx lib/invite/verify-store.ts
 */

import assert from "node:assert/strict";

import {
  acceptInvite,
  cancelInviteOnLogout,
  openInvite,
  readInvite,
} from "./store";

const MARTA = { id: "marta", name: "Marta", avatarUrl: null };
const KUBA = { id: "kuba", name: "Kuba", avatarUrl: null };
const NOW = 1_700_000_000_000;

let assertions = 0;

function expectEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.strictEqual(actual, expected, message);
}

const opened = openInvite(MARTA, NOW);
expectEqual(opened.status, "waiting_for_opponent", "Marta's invitation is waiting");

cancelInviteOnLogout(KUBA.id, NOW + 1_000);
expectEqual(
  readInvite(MARTA.id, NOW + 1_000).status,
  "waiting_for_opponent",
  "Kuba logging out before he accepts leaves Marta's invitation open",
);

cancelInviteOnLogout(MARTA.id, NOW + 2_000);
const cancelled = readInvite(KUBA.id, NOW + 2_000);
expectEqual(cancelled.status, "cancelled", "Marta logging out cancels her unaccepted invitation");
expectEqual(cancelled.role, "opponent", "Kuba still sees that invitation as the other player");

const again = openInvite(KUBA, NOW + 3_000);
expectEqual(again.status, "waiting_for_opponent", "a cancelled invitation can be replaced");
const accepted = acceptInvite(MARTA, NOW + 4_000);
expectEqual(accepted.status, "confirmed_ready", "Marta accepts Kuba's invitation");

cancelInviteOnLogout(KUBA.id, NOW + 5_000);
expectEqual(
  readInvite(MARTA.id, NOW + 5_000).status,
  "confirmed_ready",
  "logout after acceptance does not cancel the invitation",
);

console.log(`Invitation logout verification passed (${assertions} assertions).`);
