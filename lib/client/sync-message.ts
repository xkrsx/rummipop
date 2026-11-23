const OFFLINE_MESSAGE = "Brak połączenia. Ponawiam synchronizację.";
const RETRY_MESSAGE = "Nie udało się połączyć z serwerem. Ponawiam synchronizację.";

/** Polish status for a failed poll. Network errors never surface their English text. */
export function syncFailureMessage(error: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return OFFLINE_MESSAGE;
  }

  if (error instanceof TypeError) {
    return RETRY_MESSAGE;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return RETRY_MESSAGE;
}

export function offlineSyncMessage(): string {
  return OFFLINE_MESSAGE;
}
