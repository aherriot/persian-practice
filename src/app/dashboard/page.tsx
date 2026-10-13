import Link from "next/link";
import { canReviewAudio } from "@/lib/auth/reviewer";
import { requireUser } from "@/lib/auth/session";
import { signOut } from "@/lib/auth";
import { HISTORY_DAYS, loadActivityHours } from "@/lib/lesson/history";
import { loadKnowledge, themeSummaries } from "@/lib/lesson/store";
import { actionClass } from "./styles";
import { Today } from "./Today";

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();
  // Counted from what the learner has met rather than added up over themes, which share words.
  const [knowledge, hours] = await Promise.all([loadKnowledge(user.id), loadActivityHours(user.id, now)]);
  const themes = await themeSummaries(user.id, now, knowledge);
  const due = [...knowledge.values()].filter((state) => state.dueAt <= now).length;

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

      <Today hours={hours} historyDays={HISTORY_DAYS} due={due} met={knowledge.size}>
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-ink/10 pt-3">
          <Link href="/progress" className="text-sm font-medium text-cobalt underline">
            See your progress
          </Link>
          <Link href="/reference" className="text-sm font-medium text-cobalt underline">
            Look up a word or grammar note
          </Link>
        </div>
      </Today>

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
                className={actionClass}
              >
                {theme.learned === 0 ? "Start" : "Practise"}
              </Link>
            </div>
          </article>
        ))}
      </section>

      <p className="text-xs text-ink/40">
        Signed in as {user.email ?? user.name ?? user.id}
        {canReviewAudio(user.email) && (
          <>
            {" · "}
            <Link href="/review" className="underline">
              Review audio
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
