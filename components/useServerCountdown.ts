"use client";

import { useState, useSyncExternalStore } from "react";

const CLOCK_INTERVAL_MS = 200;

const listeners = new Set<() => void>();
let cachedNow = 0;
let timer = 0;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (timer === 0) {
    timer = window.setInterval(() => {
      cachedNow = Date.now();
      listeners.forEach((listener) => {
        listener();
      });
    }, CLOCK_INTERVAL_MS);
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      timer = 0;
    }
  };
}

/** Stable between notifications so a render can read the clock twice. */
function getClientNow(): number {
  if (cachedNow === 0) {
    cachedNow = Date.now();
  }

  return cachedNow;
}

function getServerNow(): number {
  return 0;
}

interface ClockAnchor {
  serverNow: string | null;
  clientNow: number | null;
}

/**
 * Local countdown corrected by the latest server clock.
 * The server still decides when the deadline has passed.
 */
export function useServerCountdown(
  expiresAt: string | null,
  serverNow: string | null,
  fallbackMs: number,
  active: boolean,
): number {
  const clientNow = useSyncExternalStore(subscribe, getClientNow, getServerNow);
  const [anchor, setAnchor] = useState<ClockAnchor>({
    serverNow: null,
    clientNow: null,
  });

  if (clientNow !== 0 && (anchor.clientNow === null || anchor.serverNow !== serverNow)) {
    setAnchor({ serverNow, clientNow });
  }

  if (
    !active ||
    expiresAt === null ||
    serverNow === null ||
    clientNow === 0 ||
    anchor.clientNow === null ||
    anchor.serverNow !== serverNow
  ) {
    return active ? Math.max(0, fallbackMs) : 0;
  }

  const expiresAtMs = Date.parse(expiresAt);
  const serverNowMs = Date.parse(serverNow);
  if (Number.isNaN(expiresAtMs) || Number.isNaN(serverNowMs)) {
    return Math.max(0, fallbackMs);
  }

  const elapsed = clientNow - anchor.clientNow;
  return Math.max(0, expiresAtMs - serverNowMs - elapsed);
}
