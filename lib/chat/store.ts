import { localChatLog } from "@/lib/chat/file-log";
import { ChatStoreError } from "@/lib/chat/errors";
import type { ChatSnapshot } from "@/lib/chat/types";
import { validateChatText } from "@/lib/chat/validate";
import { supabase } from "@/lib/supabase";
import type { ChatMessage } from "@/types/database";

const MESSAGE_COLUMNS = "id, sender_id, sender_name, body, created_at";

const SAVE_FAILED_MESSAGE = "Nie udało się wysłać wiadomości. Spróbuj ponownie.";
const READ_FAILED_MESSAGE = "Nie udało się odczytać czatu. Spróbuj ponownie.";

export interface ChatSender {
  id: string;
  name: string;
}

type ChatBackend = "supabase" | "file";

let backend: ChatBackend | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorCode(error: unknown): string | null {
  if (!isRecord(error) || typeof error.code !== "string") {
    return null;
  }

  return error.code;
}

function errorText(error: unknown): string {
  if (!isRecord(error) || typeof error.message !== "string") {
    return "";
  }

  return error.message;
}

function isMissingTable(error: unknown): boolean {
  const code = errorCode(error);
  if (code === "42P01" || code === "PGRST205") {
    return true;
  }

  return /chat_messages/i.test(errorText(error)) && /does not exist|schema cache/i.test(errorText(error));
}

function throwStoreError(error: unknown, fallback: string): never {
  if (errorCode(error) === "23514") {
    throw new ChatStoreError(SAVE_FAILED_MESSAGE, 400);
  }

  throw new ChatStoreError(fallback, 500);
}

function messageFromRow(row: unknown): ChatMessage {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.sender_id !== "string" ||
    typeof row.sender_name !== "string" ||
    typeof row.body !== "string" ||
    typeof row.created_at !== "string"
  ) {
    throw new ChatStoreError(READ_FAILED_MESSAGE, 500);
  }

  return {
    id: row.id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    text: row.body,
    createdAt: row.created_at,
  };
}

function compareMessages(left: ChatMessage, right: ChatMessage): number {
  if (left.createdAt === right.createdAt) {
    if (left.id === right.id) {
      return 0;
    }

    return left.id < right.id ? -1 : 1;
  }

  return left.createdAt < right.createdAt ? -1 : 1;
}

/**
 * Shared chat for the two fixed players.
 * Nothing here deletes messages. A new match and a sign-out leave the thread in place.
 * When `chat_messages` exists, that table is the log and `created_at` is the database clock.
 * Until then, this server keeps the same log in a local file and sets `createdAt` itself.
 */
async function chatUsesDatabase(): Promise<boolean> {
  if (backend === "supabase") {
    return true;
  }

  if (backend === "file") {
    return false;
  }

  const { error } = await supabase.from("chat_messages").select("id").limit(1);
  if (!error) {
    backend = "supabase";
    return true;
  }

  if (isMissingTable(error)) {
    backend = "file";
    return false;
  }

  throwStoreError(error, READ_FAILED_MESSAGE);
}

async function listFromSupabase(): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throwStoreError(error, READ_FAILED_MESSAGE);
  }

  if (!Array.isArray(data)) {
    throw new ChatStoreError(READ_FAILED_MESSAGE, 500);
  }

  return data.map((row) => messageFromRow(row));
}

async function appendToSupabase(sender: ChatSender, text: string): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      sender_id: sender.id,
      sender_name: sender.name,
      body: text,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    throwStoreError(error, SAVE_FAILED_MESSAGE);
  }

  return messageFromRow(data);
}

export async function listChatMessages(): Promise<ChatMessage[]> {
  if (await chatUsesDatabase()) {
    return listFromSupabase();
  }

  return localChatLog.list();
}

export async function readChatSnapshot(): Promise<ChatSnapshot> {
  return {
    messages: await listChatMessages(),
    serverNow: new Date().toISOString(),
  };
}

/**
 * Appends one message as the given player.
 * The caller must pass the authenticated player. Client-supplied identity is ignored.
 * The server assigns `createdAt`.
 */
export async function appendChatMessage(sender: ChatSender, rawText: string): Promise<ChatMessage> {
  const text = validateChatText(rawText);
  const senderId = sender.id.trim();
  if (senderId.length === 0) {
    throw new ChatStoreError(SAVE_FAILED_MESSAGE, 400);
  }

  const trimmedName = sender.name.trim();
  const cleanSender = {
    id: senderId,
    name: trimmedName.length > 0 ? trimmedName : "Gracz",
  };

  if (await chatUsesDatabase()) {
    return appendToSupabase(cleanSender, text);
  }

  return localChatLog.append(cleanSender, text);
}

/** Puts a just-written message back if a following read has not caught up yet. */
export function withMessage(snapshot: ChatSnapshot, message: ChatMessage): ChatSnapshot {
  if (snapshot.messages.some((existing) => existing.id === message.id)) {
    return snapshot;
  }

  return {
    ...snapshot,
    messages: [...snapshot.messages, message].sort(compareMessages),
  };
}
