/** Shown while a poll is failing or waiting to retry. Hidden once the server answers. */
export function SyncStatus({ message }: { message: string | null }) {
  if (message === null) {
    return null;
  }

  return (
    <p
      role="status"
      className="rounded-2xl border border-amber-400/40 bg-amber-950/50 px-4 py-3 text-center text-sm font-medium text-amber-100"
    >
      {message}
    </p>
  );
}
