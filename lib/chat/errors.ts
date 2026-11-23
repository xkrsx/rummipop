/**
 * Failure while reading or writing the shared chat.
 * `message` is Polish and safe to show to the player.
 */
export class ChatStoreError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ChatStoreError";
    this.statusCode = statusCode;
  }
}
