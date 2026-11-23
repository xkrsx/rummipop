import { Suspense } from "react";
import { HomeScreen } from "@/components/HomeScreen";
import { readSessionPlayer } from "@/lib/auth/session";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 text-white">
      <Suspense fallback={<SessionRestoreFallback />}>
        <HomeSession />
      </Suspense>
    </main>
  );
}

async function HomeSession() {
  const player = await readSessionPlayer();
  return <HomeScreen initialPlayer={player} />;
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
