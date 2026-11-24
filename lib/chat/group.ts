/**
 * Groups a chronological two-player thread into time blocks.
 * The first message always opens a block. A later message opens another
 * only when it is more than five minutes after the previous message.
 */

export const CHAT_TIME_BLOCK_GAP_MS = 5 * 60 * 1000;

export interface ChatBubbleLayout {
  /** Render the shared timestamp divider above this bubble. */
  startsTimeBlock: boolean;
  /** Same sender as the previous bubble, inside the same time block. */
  continuesSpeaker: boolean;
}

function exceedsTimeBlockGap(previousCreatedAt: string, createdAt: string): boolean {
  const previousMs = Date.parse(previousCreatedAt);
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(previousMs) || Number.isNaN(createdMs)) {
    return true;
  }

  return createdMs - previousMs > CHAT_TIME_BLOCK_GAP_MS;
}

/** `messages` must already be in chronological order. */
export function layoutChatBubbles(
  messages: readonly { senderId: string; createdAt: string }[],
): ChatBubbleLayout[] {
  return messages.map((message, index) => {
    const previous = index > 0 ? messages[index - 1] : undefined;
    const startsTimeBlock =
      previous === undefined || exceedsTimeBlockGap(previous.createdAt, message.createdAt);

    return {
      startsTimeBlock,
      continuesSpeaker:
        previous !== undefined && !startsTimeBlock && previous.senderId === message.senderId,
    };
  });
}
