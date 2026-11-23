/** Upper bound for one chat message, counted in Unicode code points. */
export const MAX_CHAT_TEXT_LENGTH = 500;

export const EMPTY_CHAT_MESSAGE = "Wpisz wiadomość.";
export const LONG_CHAT_MESSAGE = `Wiadomość jest za długa. Możesz wpisać najwyżej ${MAX_CHAT_TEXT_LENGTH} znaków.`;

/** Rejects a chat body before it is stored. The message is Polish and safe to show. */
export class ChatInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatInputError";
  }
}

function characterCount(text: string): number {
  return Array.from(text).length;
}

/**
 * Trims a submitted message and returns the text to store.
 * Empty and over-long values throw {@link ChatInputError}.
 */
export function validateChatText(value: unknown): string {
  if (typeof value !== "string") {
    throw new ChatInputError(EMPTY_CHAT_MESSAGE);
  }

  const text = value.trim();
  if (text.length === 0) {
    throw new ChatInputError(EMPTY_CHAT_MESSAGE);
  }

  if (characterCount(text) > MAX_CHAT_TEXT_LENGTH) {
    throw new ChatInputError(LONG_CHAT_MESSAGE);
  }

  return text;
}
