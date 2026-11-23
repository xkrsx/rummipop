import Link from "next/link";
import { Suspense } from "react";
import { HomeScreen } from "@/components/HomeScreen";
import { SessionLookupError, readSessionPlayer } from "@/lib/auth/session";
import type { SessionPlayer } from "@/types/database";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 text-white">
      <Suspense fallback={<SessionRestoreFallback />}>
        <HomeSession />
      </Suspense>
    </main>
  );
}

async function loadHomeSession(): Promise<
  | { status: "ready"; player: SessionPlayer | null }
  | { status: "offline"; message: string }
> {
  try {
    return { status: "ready", player: await readSessionPlayer() };
  } catch (error) {
    if (error instanceof SessionLookupError) {
      return { status: "offline", message: error.message };
    }

    throw error;
  }
}

async function HomeSession() {
  const session = await loadHomeSession();
  if (session.status === "offline") {
    return <SessionReconnect message={session.message} />;
  }

  return <HomeScreen initialPlayer={session.player} />;
}

function SessionReconnect({ message }: { message: string }) {
  return (
    <section
      aria-label="Połączenie z serwerem"
      className="flex w-full max-w-sm flex-col gap-4 rounded-3xl border border-amber-400/40 bg-zinc-900 px-6 py-6 text-center shadow-sm"
    >
      <p className="text-sm font-medium text-amber-100">{message}</p>
      <Link
        href="/"
        className="flex h-14 w-full items-center justify-center rounded-2xl bg-white text-base font-semibold text-zinc-950 shadow-sm transition hover:bg-zinc-200"
      >
        Odśwież stronę
      </Link>
    </section>
  );
}

function SessionRestoreFallback() {
  return (
    <p className="flex items-center gap-2 text-sm font-medium text-zinc-300">
      <span
        className="size-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-100"
        aria-hidden="true"
      />
      Przywracanie sesji
    </p>
  );
}
