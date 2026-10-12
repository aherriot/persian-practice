/** Shown the moment a theme is clicked, while the server plans the session. Mirrors the start screen's frame. */
export default function Loading() {
  return (
    <main
      aria-busy="true"
      className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 bg-paper px-5 py-6"
    >
      <p role="status" className="text-sm text-ink/55">
        Preparing your lesson…
      </p>
      <div className="flex animate-pulse flex-col gap-4" aria-hidden="true">
        <div className="h-8 w-2/5 rounded bg-ink/10" />
        <div className="h-4 w-full rounded bg-ink/10" />
        <div className="h-4 w-4/5 rounded bg-ink/10" />
        <div className="mt-4 h-11 w-32 rounded-t-2xl rounded-b-md bg-ink/10" />
      </div>
    </main>
  );
}
