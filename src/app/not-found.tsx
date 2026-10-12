import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-6 bg-paper px-5 py-8 text-center">
      <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">Nothing here</h1>
      <p className="max-w-xs text-sm leading-relaxed text-ink/70">
        There is no page at this address. It may have been a theme or a word that has since been removed.
      </p>
      <Link
        href="/dashboard"
        className="rounded-t-2xl rounded-b-md border-[1.5px] border-gold bg-cobalt px-5 py-2 text-sm font-medium tracking-wide text-sand shadow-[0_0_0_3px_var(--color-sand),0_0_0_4px_var(--color-ink)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-turquoise-dark"
      >
        Back to the start
      </Link>
    </main>
  );
}
