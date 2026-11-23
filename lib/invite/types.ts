/** How long the second player has to confirm a new match. */
export const INVITE_WINDOW_MS = 90_000;

export const INVITE_STATUSES = [
  "idle",
  "waiting_for_opponent",
  "confirmed_ready",
  "expired",
  "cancelled",
] as const;

export type InviteStatus = (typeof INVITE_STATUSES)[number];

export type InviteRole = "host" | "opponent" | "none";

/** Public player fields attached to an invitation. The PIN is never included. */
export interface InviteParticipant {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Invitation as seen by one signed-in player.
 * `remainingMs` is computed on the server from `expiresAt`.
 */
export interface InviteSnapshot {
  /** Increases on each invitation change so clients can ignore stale polls. */
  revision: number;
  status: InviteStatus;
  role: InviteRole;
  serverNow: string;
  expiresAt: string | null;
  remainingMs: number;
  host: InviteParticipant | null;
  opponent: InviteParticipant | null;
  confirmedAt: string | null;
}
