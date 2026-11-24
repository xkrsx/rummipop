import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ChatStoreError } from "@/lib/chat/errors";
import { compareChatMessages } from "@/lib/chat/page";
import { validateChatText } from "@/lib/chat/validate";
import type { ChatMessage } from "@/types/database";

const READ_FAILED_MESSAGE = "Nie udało się odczytać czatu. Spróbuj ponownie.";
const SAVE_FAILED_MESSAGE = "Nie udało się wysłać wiadomości. Spróbuj ponownie.";

export interface ChatLogSender {
  id: string;
  name: string;
}

interface NodeError extends Error {
  code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error;
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

/**
 * One JSON file of chat messages on this server.
 * Used when the database table is not present yet.
 * The file is never cleared when a match starts or a player signs out.
 */
export function createChatLog(filePath: string) {
  let queue: Promise<void> = Promise.resolve();

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function readMessages(): Promise<ChatMessage[]> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw new ChatStoreError(READ_FAILED_MESSAGE, 500);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ChatStoreError(READ_FAILED_MESSAGE, 500);
    }

    if (!Array.isArray(parsed) || !parsed.every((entry) => isChatMessage(entry))) {
      throw new ChatStoreError(READ_FAILED_MESSAGE, 500);
    }

    return [...parsed].sort(compareChatMessages);
  }

  async function writeMessages(messages: readonly ChatMessage[]): Promise<void> {
    const directory = path.dirname(filePath);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(messages), "utf8");
      await rename(temporary, filePath);
    } catch {
      await unlink(temporary).catch(() => undefined);
      throw new ChatStoreError(SAVE_FAILED_MESSAGE, 500);
    }
  }

  return {
    list(): Promise<ChatMessage[]> {
      return exclusive(() => readMessages());
    },

    /**
     * Appends one message. `createdAt` is set here, on the server.
     * Earlier messages stay in the file.
     */
    append(sender: ChatLogSender, rawText: string): Promise<ChatMessage> {
      const text = validateChatText(rawText);
      const senderId = sender.id.trim();
      if (senderId.length === 0) {
        return Promise.reject(new ChatStoreError(SAVE_FAILED_MESSAGE, 400));
      }

      const trimmedName = sender.name.trim();
      const message: ChatMessage = {
        id: randomUUID(),
        senderId,
        senderName: trimmedName.length > 0 ? trimmedName : "Gracz",
        text,
        createdAt: new Date().toISOString(),
      };

      return exclusive(async () => {
        const messages = await readMessages();
        await writeMessages([...messages, message]);
        return message;
      });
    },
  };
}

export const localChatLog = createChatLog(path.join(process.cwd(), "data", "chat-messages.json"));
