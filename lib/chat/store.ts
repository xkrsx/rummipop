import { localChatLog } from "@/lib/chat/file-log";
import { ChatStoreError } from "@/lib/chat/errors";
import {
  CHAT_NEWER_FETCH_LIMIT,
  CHAT_RECENT_PAGE_SIZE,
  compareChatMessages,
  pageChatMessages,
  type ChatCursor,
  type ChatReadQuery,
} from "@/lib/chat/page";
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

interface SupabaseResult {
  data: unknown;
  error: unknown;
}

async function readRows(query: PromiseLike<SupabaseResult>): Promise<ChatMessage[]> {
  const { data, error } = await query;
  if (error) {
    throwStoreError(error, READ_FAILED_MESSAGE);
  }

  if (!Array.isArray(data)) {
    throw new ChatStoreError(READ_FAILED_MESSAGE, 500);
  }

  return data.map((row) => messageFromRow(row));
}

function messageSelect() {
  return supabase.from("chat_messages").select(MESSAGE_COLUMNS);
}

async function listFromSupabase(): Promise<ChatMessage[]> {
  return readRows(
    messageSelect().order("created_at", { ascending: true }).order("id", { ascending: true }),
  );
}

/** Newest-first rows become oldest-first. An extra row means older history remains. */
function chronologicalPage(newestFirst: readonly ChatMessage[], pageSize: number): {
  messages: ChatMessage[];
  hasOlder: boolean;
} {
  const hasOlder = newestFirst.length > pageSize;
  const kept = hasOlder ? newestFirst.slice(0, pageSize) : newestFirst;
  return {
    messages: [...kept].reverse(),
    hasOlder,
  };
}

/**
 * Same window as {@link pageChatMessages}, applied in the database.
 * Ties on `created_at` use `id`, matching the file log.
 */
async function pageFromSupabase(query: ChatReadQuery): Promise<{
  messages: ChatMessage[];
  hasOlder: boolean | null;
}> {
  if (query.after) {
    return messagesAfter(query.after);
  }

  if (query.before) {
    return messagesBefore(query.before);
  }

  const newestFirst = await readRows(
    messageSelect()
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(CHAT_RECENT_PAGE_SIZE + 1),
  );
  return chronologicalPage(newestFirst, CHAT_RECENT_PAGE_SIZE);
}

async function messagesBefore(cursor: ChatCursor): Promise<{ messages: ChatMessage[]; hasOlder: boolean }> {
  const limit = CHAT_RECENT_PAGE_SIZE + 1;
  const sameInstant = await readRows(
    messageSelect()
      .eq("created_at", cursor.createdAt)
      .lt("id", cursor.id)
      .order("id", { ascending: false })
      .limit(limit),
  );

  let newestFirst = sameInstant;
  if (sameInstant.length < limit) {
    const earlier = await readRows(
      messageSelect()
        .lt("created_at", cursor.createdAt)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit - sameInstant.length),
    );
    newestFirst = [...sameInstant, ...earlier];
  }

  return chronologicalPage(newestFirst, CHAT_RECENT_PAGE_SIZE);
}

async function messagesAfter(cursor: ChatCursor): Promise<{ messages: ChatMessage[]; hasOlder: null }> {
  const sameInstant = await readRows(
    messageSelect()
      .eq("created_at", cursor.createdAt)
      .gt("id", cursor.id)
      .order("id", { ascending: true })
      .limit(CHAT_NEWER_FETCH_LIMIT),
  );

  let messages = sameInstant;
  if (sameInstant.length < CHAT_NEWER_FETCH_LIMIT) {
    const later = await readRows(
      messageSelect()
        .gt("created_at", cursor.createdAt)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(CHAT_NEWER_FETCH_LIMIT - sameInstant.length),
    );
    messages = [...sameInstant, ...later];
  }

  return { messages, hasOlder: null };
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

/**
 * One page of the shared thread.
 * No query returns the recent preview. `before` returns the next older page.
 * `after` returns messages written since that cursor and leaves `hasOlder` null.
 */
export async function readChatSnapshot(query: ChatReadQuery = {}): Promise<ChatSnapshot> {
  const page = (await chatUsesDatabase())
    ? await pageFromSupabase(query)
    : pageChatMessages(await localChatLog.list(), query);

  return {
    messages: [...page.messages].sort(compareChatMessages),
    hasOlder: page.hasOlder,
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
    messages: [...snapshot.messages, message].sort(compareChatMessages),
  };
}
