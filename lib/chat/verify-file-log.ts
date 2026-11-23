/**
 * Checks that the local chat log keeps messages and stamps them on the server.
 * Run with: npx tsx lib/chat/verify-file-log.ts
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createChatLog } from "./file-log";

const ANNA = { id: "anna", name: "Anna" };
const BARTEK = { id: "bartek", name: "Bartek" };

let assertions = 0;

function expectEqual<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.strictEqual(actual, expected, message);
}

async function main(): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "rummipop-chat-"));
  const log = createChatLog(path.join(directory, "chat-messages.json"));

  try {
    expectEqual((await log.list()).length, 0, "a new log is empty");

    const first = await log.append(ANNA, "  pierwsza  ");
    const second = await log.append(BARTEK, "druga");
    const stored = await log.list();

    expectEqual(stored.length, 2, "a second message does not clear the first");
    expectEqual(stored[0]?.id, first.id, "the first message stays first");
    expectEqual(stored[0]?.text, "pierwsza", "stored text is trimmed");
    expectEqual(stored[0]?.senderId, ANNA.id, "the sender id is the player passed by the server");
    expectEqual(stored[0]?.senderName, ANNA.name, "the sender name is stored with the message");
    expectEqual(stored[1]?.senderId, BARTEK.id, "the second sender stays distinct");
    expectEqual(stored[1]?.text, "druga", "the second message is kept");
    expectEqual(Number.isNaN(Date.parse(first.createdAt)), false, "createdAt is a server timestamp");
    expectEqual(first.createdAt <= second.createdAt, true, "later messages are not stamped earlier");
    expectEqual(stored[1]?.id, second.id, "reading the log again returns the same second message");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log(`Chat file log passed (${assertions} assertions).`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
