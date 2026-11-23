import { unstable_rethrow } from "next/navigation";
import { SessionLookupError, readSessionPlayer } from "@/lib/auth/session";
import { ChatStoreError } from "@/lib/chat/errors";
import { appendChatMessage, readChatSnapshot, withMessage } from "@/lib/chat/store";
import type { ChatSnapshot } from "@/lib/chat/types";
import { ChatInputError, EMPTY_CHAT_MESSAGE, validateChatText } from "@/lib/chat/validate";

const UNAUTHENTICATED_MESSAGE = "Zaloguj się, aby pisać na czacie.";
const UNEXPECTED_MESSAGE = "Nie udało się zsynchronizować czatu. Spróbuj ponownie.";
const UNREADABLE_MESSAGE = "Nie udało się odczytać wiadomości.";

export function chatJson(body: ChatSnapshot | { message: string }, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function textFromPayload(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null || !("text" in payload)) {
    return undefined;
  }

  return payload.text;
}

async function readSubmittedText(request: Request): Promise<string> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ChatInputError(UNREADABLE_MESSAGE);
  }

  const text = textFromPayload(payload);
  if (text === undefined) {
    throw new ChatInputError(EMPTY_CHAT_MESSAGE);
  }

  return validateChatText(text);
}

function chatErrorResponse(error: unknown): Response {
  if (error instanceof SessionLookupError) {
    return chatJson({ message: error.message }, 503);
  }

  if (error instanceof ChatInputError) {
    return chatJson({ message: error.message }, 400);
  }

  if (error instanceof ChatStoreError) {
    return chatJson({ message: error.message }, error.statusCode);
  }

  return chatJson({ message: UNEXPECTED_MESSAGE }, 500);
}

/** Requires a session, then returns the full shared thread. */
export async function handleChatRead(): Promise<Response> {
  try {
    const player = await readSessionPlayer();
    if (player === null) {
      return chatJson({ message: UNAUTHENTICATED_MESSAGE }, 401);
    }

    return chatJson(await readChatSnapshot());
  } catch (error) {
    unstable_rethrow(error);
    return chatErrorResponse(error);
  }
}

/**
 * Stores one message for the signed-in player.
 * The sender and the timestamp are taken on the server.
 */
export async function handleChatSend(request: Request): Promise<Response> {
  try {
    const player = await readSessionPlayer();
    if (player === null) {
      return chatJson({ message: UNAUTHENTICATED_MESSAGE }, 401);
    }

    const text = await readSubmittedText(request);
    const created = await appendChatMessage({ id: player.id, name: player.name }, text);
    const snapshot = withMessage(await readChatSnapshot(), created);
    return chatJson(snapshot);
  } catch (error) {
    unstable_rethrow(error);
    return chatErrorResponse(error);
  }
}
