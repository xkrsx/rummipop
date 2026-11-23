import { INVITE_WINDOW_MS, type InviteParticipant, type InviteRole, type InviteSnapshot } from "@/lib/invite/types";

const STORE_KEY = "__rummipopInviteStore";

type ActiveStatus = "waiting_for_opponent" | "confirmed_ready" | "expired" | "cancelled";

interface InviteRecord {
  id: string;
  status: ActiveStatus;
  host: InviteParticipant;
  opponent: InviteParticipant | null;
  createdAtMs: number;
  expiresAtMs: number;
  confirmedAtMs: number | null;
  cancelledAtMs: number | null;
}

interface InviteStore {
  record: InviteRecord | null;
  revision: number;
  queue: Promise<void>;
}

export class InviteFlowError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "InviteFlowError";
    this.statusCode = statusCode;
  }
}

function getStore(): InviteStore {
  const scope = globalThis as typeof globalThis & {
    [STORE_KEY]?: InviteStore;
  };

  let inviteStore = scope[STORE_KEY];
  if (inviteStore === undefined) {
    inviteStore = {
      record: null,
      revision: 0,
      queue: Promise.resolve(),
    };
    scope[STORE_KEY] = inviteStore;
  }

  return inviteStore;
}

/**
 * Serializes invite transitions. Route handlers await auth before they
 * touch the store, so two requests must not interleave those writes.
 */
export function runInviteFlow<T>(task: () => T): Promise<T> {
  const inviteStore = getStore();
  const result = inviteStore.queue.then(task);
  inviteStore.queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function markChanged(): void {
  getStore().revision += 1;
}

function settle(now: number): InviteRecord | null {
  const record = getStore().record;

  if (
    record !== null &&
    record.status === "waiting_for_opponent" &&
    now >= record.expiresAtMs
  ) {
    record.status = "expired";
    markChanged();
  }

  return record;
}

function roleFor(record: InviteRecord | null, playerId: string): InviteRole {
  if (record === null) {
    return "none";
  }

  if (record.host.id === playerId) {
    return "host";
  }

  return "opponent";
}

function toSnapshot(record: InviteRecord | null, playerId: string, now: number): InviteSnapshot {
  if (record === null) {
    return {
      revision: getStore().revision,
      status: "idle",
      role: "none",
      serverNow: new Date(now).toISOString(),
      expiresAt: null,
      remainingMs: 0,
      host: null,
      opponent: null,
      confirmedAt: null,
    };
  }

  const remainingMs =
    record.status === "waiting_for_opponent"
      ? Math.max(0, record.expiresAtMs - now)
      : 0;

  return {
    revision: getStore().revision,
    status: record.status,
    role: roleFor(record, playerId),
    serverNow: new Date(now).toISOString(),
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    remainingMs,
    host: record.host,
    opponent: record.opponent,
    confirmedAt:
      record.confirmedAtMs === null ? null : new Date(record.confirmedAtMs).toISOString(),
  };
}

function replaceWithWaiting(host: InviteParticipant, now: number): InviteRecord {
  const record: InviteRecord = {
    id: crypto.randomUUID(),
    status: "waiting_for_opponent",
    host,
    opponent: null,
    createdAtMs: now,
    expiresAtMs: now + INVITE_WINDOW_MS,
    confirmedAtMs: null,
    cancelledAtMs: null,
  };

  getStore().record = record;
  markChanged();
  return record;
}

/** Current invitation for the signed-in player, with expiry applied. */
export function readInvite(playerId: string, now = Date.now()): InviteSnapshot {
  return toSnapshot(settle(now), playerId, now);
}

/**
 * Opens a 90-second invitation. The same host can repeat the call while
 * the window is still open and receives the existing invitation.
 */
export function openInvite(host: InviteParticipant, now = Date.now()): InviteSnapshot {
  const current = settle(now);

  if (current === null || current.status === "expired" || current.status === "cancelled") {
    return toSnapshot(replaceWithWaiting(host, now), host.id, now);
  }

  if (current.status === "confirmed_ready") {
    throw new InviteFlowError(
      "Obaj gracze są już gotowi. Gra się zaczyna.",
      409,
    );
  }

  if (current.host.id === host.id) {
    return toSnapshot(current, host.id, now);
  }

  throw new InviteFlowError(
    "Zaproszenie już czeka na drugiego gracza. Potwierdź gotowość, zanim minie czas.",
    409,
  );
}

/** Second player confirms the open invitation before it expires. */
export function acceptInvite(player: InviteParticipant, now = Date.now()): InviteSnapshot {
  const current = settle(now);

  if (current === null) {
    throw new InviteFlowError("Nie ma aktywnego zaproszenia.", 409);
  }

  if (current.status === "expired") {
    throw new InviteFlowError(
      "Czas na potwierdzenie minął. Zaproszenie wygasło.",
      409,
    );
  }

  if (current.status === "cancelled") {
    throw new InviteFlowError("To zaproszenie zostało anulowane.", 409);
  }

  if (current.status === "confirmed_ready") {
    return toSnapshot(current, player.id, now);
  }

  if (current.host.id === player.id) {
    throw new InviteFlowError("Nie możesz potwierdzić własnego zaproszenia.", 409);
  }

  current.status = "confirmed_ready";
  current.opponent = player;
  current.confirmedAtMs = now;
  markChanged();
  return toSnapshot(current, player.id, now);
}

/**
 * Either player can leave a waiting or ready invitation.
 * An already expired invitation stays expired.
 */
export function cancelInvite(playerId: string, now = Date.now()): InviteSnapshot {
  const current = settle(now);

  if (current === null) {
    throw new InviteFlowError("Nie ma aktywnego zaproszenia.", 409);
  }

  if (current.status === "expired" || current.status === "cancelled") {
    return toSnapshot(current, playerId, now);
  }

  current.status = "cancelled";
  current.cancelledAtMs = now;
  markChanged();
  return toSnapshot(current, playerId, now);
}
