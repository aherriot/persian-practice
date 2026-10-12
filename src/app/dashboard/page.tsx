import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { signOut } from "@/lib/auth";
import { themeSummaries } from "@/lib/lesson/store";

export default async function DashboardPage() {
  const user = await requireUser();
  const themes = await themeSummaries(user.id);
  const learned = themes.reduce((n, theme) => n + theme.learned, 0);
  const due = themes.reduce((n, theme) => n + theme.due, 0);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-8 bg-paper px-5 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">Persian Practice</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/sign-in" });
          }}
        >
          <button type="submit" className="text-sm text-ink/50 underline">
            Sign out
          </button>
        </form>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-ink/15 bg-sand px-5 py-4 shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35)]">
        <h2 className="text-lg font-semibold text-ink">Practise everything</h2>
        <p className="text-sm text-ink/65">
          Reviews whatever is due across all your themes, then adds a little that is new.
        </p>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink/55">
            {learned} words and patterns learned
            {due > 0 && ` · ${due} due for review`}
          </p>
          <Link
            href="/practice"
            className="rounded-t-2xl rounded-b-md border-[1.5px] border-gold bg-cobalt px-5 py-2 text-sm font-medium tracking-wide text-sand shadow-[0_0_0_3px_var(--color-sand),0_0_0_4px_var(--color-ink)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-turquoise-dark"
          >
            Practise
          </Link>
        </div>
        <Link href="/reference" className="text-sm font-medium text-cobalt underline">
          Look up a word or grammar note
        </Link>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink/50">Themes</h2>
        {themes.length === 0 && <p className="text-sm text-ink/60">No themes yet. Run `npm run db:seed`.</p>}
        {themes.map((theme) => (
          <article
            key={theme.id}
            className="flex flex-col gap-3 rounded-lg border border-ink/15 bg-sand px-5 py-4 shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35)]"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-lg font-semibold text-ink">{theme.title}</h3>
              <span dir="rtl" lang="fa" className="text-xl text-ink/70">
                {theme.titleFa}
              </span>
            </div>
            <p className="text-sm text-ink/65">{theme.description}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full rounded-full bg-turquoise-dark"
                style={{ width: `${theme.total === 0 ? 0 : (theme.learned / theme.total) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-ink/55">
                {theme.learned} of {theme.total} words and patterns met
                {theme.due > 0 && ` · ${theme.due} due for review`}
              </p>
              <Link
                href={`/learn/${theme.id}`}
                className="rounded-t-2xl rounded-b-md border-[1.5px] border-gold bg-cobalt px-5 py-2 text-sm font-medium tracking-wide text-sand shadow-[0_0_0_3px_var(--color-sand),0_0_0_4px_var(--color-ink)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-turquoise-dark"
              >
                {theme.learned === 0 ? "Start" : "Practise"}
              </Link>
            </div>
          </article>
        ))}
      </section>

      <p className="text-xs text-ink/40">Signed in as {user.email ?? user.name ?? user.id}</p>
    </main>
  );
}
