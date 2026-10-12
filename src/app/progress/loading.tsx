/** Shown while the server adds up the learner's progress. */
export default function Loading() {
  return (
    <main aria-busy="true" className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 bg-paper px-5 py-8">
      <p role="status" className="text-sm text-ink/55">
        Adding up your progress…
      </p>
      <div className="flex animate-pulse flex-col gap-4" aria-hidden="true">
        <div className="h-8 w-2/5 rounded bg-ink/10" />
        <div className="h-24 w-full rounded-lg bg-ink/10" />
        <div className="h-40 w-full rounded-lg bg-ink/10" />
      </div>
    </main>
  );
}
