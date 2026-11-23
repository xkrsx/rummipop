import { handleChatRead, handleChatSend } from "@/lib/chat/http";

/** Polled by both players. The thread is not tied to the current match. */
export async function GET(): Promise<Response> {
  return handleChatRead();
}

/** Appends one message as the authenticated player. */
export async function POST(request: Request): Promise<Response> {
  return handleChatSend(request);
}
