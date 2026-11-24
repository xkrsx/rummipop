import { unstable_rethrow } from "next/navigation";
import { SessionLookupError, readSessionPlayer } from "@/lib/auth/session";
import { ChatStoreError } from "@/lib/chat/errors";
import type { ChatCursor, ChatReadQuery } from "@/lib/chat/page";
import { appendChatMessage, readChatSnapshot, withMessage } from "@/lib/chat/store";
import type { ChatSnapshot } from "@/lib/chat/types";
import { ChatInputError, EMPTY_CHAT_MESSAGE, validateChatText } from "@/lib/chat/validate";

const UNAUTHENTICATED_MESSAGE = "Zaloguj się, aby pisać na czacie.";
const UNEXPECTED_MESSAGE = "Nie udało się zsynchronizować czatu. Spróbuj ponownie.";
const UNREADABLE_MESSAGE = "Nie udało się odczytać wiadomości.";
const INVALID_RANGE_MESSAGE = "Nie udało się odczytać czatu.";

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

function cursorPart(params: URLSearchParams, timeKey: string, idKey: string): ChatCursor | null {
  const createdAt = params.get(timeKey);
  const id = params.get(idKey);
  if (createdAt === null && id === null) {
    return null;
  }

  if (createdAt === null || id === null) {
    throw new ChatInputError(INVALID_RANGE_MESSAGE);
  }

  if (createdAt.length === 0 || createdAt.length > 40 || /[",()\\\s]/.test(createdAt)) {
    throw new ChatInputError(INVALID_RANGE_MESSAGE);
  }

  if (Number.isNaN(Date.parse(createdAt)) || !/^[0-9a-fA-F-]{1,64}$/.test(id)) {
    throw new ChatInputError(INVALID_RANGE_MESSAGE);
  }

  return { createdAt, id };
}

function readQuery(request: Request): ChatReadQuery {
  const params = new URL(request.url).searchParams;
  const before = cursorPart(params, "before", "beforeId");
  const after = cursorPart(params, "after", "afterId");
  if (before !== null && after !== null) {
    throw new ChatInputError(INVALID_RANGE_MESSAGE);
  }

  return {
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
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

/**
 * Requires a session, then returns one page of the shared thread.
 * No query: the recent preview. `before` / `beforeId`: the next older page.
 * `after` / `afterId`: messages newer than that cursor, for live polling.
 */
export async function handleChatRead(request: Request): Promise<Response> {
  try {
    const player = await readSessionPlayer();
    if (player === null) {
      return chatJson({ message: UNAUTHENTICATED_MESSAGE }, 401);
    }

    return chatJson(await readChatSnapshot(readQuery(request)));
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
    // Only the new row. A latest-page read could skip messages the poll has not seen yet.
    const snapshot = withMessage(
      {
        messages: [],
        serverNow: new Date().toISOString(),
        hasOlder: null,
      },
      created,
    );
    return chatJson(snapshot);
  } catch (error) {
    unstable_rethrow(error);
    return chatErrorResponse(error);
  }
}
