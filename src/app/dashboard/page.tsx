import Link from "next/link";
import { canReviewAudio } from "@/lib/auth/reviewer";
import { requireUser } from "@/lib/auth/session";
import { signOut } from "@/lib/auth";
import { openFlagCount } from "@/lib/lesson/flags";
import { HISTORY_DAYS, loadActivityHours } from "@/lib/lesson/history";
import { loadKnowledge, themeSummaries } from "@/lib/lesson/store";
import { weakTargets } from "@/lib/lesson/weak";
import { actionClass } from "./styles";
import { Today } from "./Today";

/** The three things to do besides practising, each a place of its own. */
const PLACES = [
  {
    href: "/progress",
    title: "Your progress",
    body: "What you know, your streak, and the words that trip you up.",
    icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  },
  {
    href: "/reference",
    title: "Dictionary",
    body: "Every word and grammar note you have met, with sentences and audio.",
    icon: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 19a2 2 0 0 1 2-2h13M9 7h6" />,
  },
  {
    href: "/add-word",
    title: "Add a word",
    body: "Heard something new? Add it and it joins your lessons.",
    icon: <path d="M12 5v14M5 12h14" />,
  },
];

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();
  // Counted from what the learner has met rather than added up over themes, which share words.
  const reviewer = canReviewAudio(user.email);
  const [knowledge, hours, flagged] = await Promise.all([
    loadKnowledge(user.id),
    loadActivityHours(user.id, now),
    openFlagCount({ id: user.id, shared: reviewer }),
  ]);
  // The learner's own words and what the app adds once the topics run out are
  // part of practice, not topics to pick, so only the curated ones are listed.
  const topics = (await themeSummaries(user.id, now, knowledge)).filter((theme) => !theme.personal);
  const due = [...knowledge.values()].filter((state) => state.dueAt <= now).length;
  const weak = weakTargets(knowledge).length;

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

      <Today hours={hours} historyDays={HISTORY_DAYS} due={due} weak={weak} met={knowledge.size} />

      <nav aria-label="More" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PLACES.map((place) => (
          <Link
            key={place.href}
            href={place.href}
            className="group flex items-start gap-3 rounded-lg border border-ink/15 bg-sand px-4 py-4 transition hover:-translate-y-0.5 hover:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-turquoise-dark sm:flex-col"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cobalt text-sand">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="h-5 w-5"
              >
                {place.icon}
              </svg>
            </span>
            <span className="flex flex-col gap-1">
              <span className="font-semibold text-ink group-hover:text-cobalt">{place.title}</span>
              <span className="text-sm leading-snug text-ink/65">{place.body}</span>
            </span>
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink/50">Topics</h2>
          <p className="text-sm text-ink/60">
            Practice works through them in order. To focus on one for a while, open it here.
          </p>
        </div>
        {topics.length === 0 && <p className="text-sm text-ink/60">No topics yet. Run `npm run db:seed`.</p>}
        {topics.map((theme) => (
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
              <Link href={`/learn/${theme.id}`} className={actionClass}>
                {theme.learned === 0 ? "Start" : "Focus on this"}
              </Link>
            </div>
          </article>
        ))}
      </section>

      <p className="text-xs text-ink/40">
        Signed in as {user.email ?? user.name ?? user.id}
        {(reviewer || flagged > 0) && (
          <>
            {" · "}
            <Link href="/review" className="underline">
              Review{flagged > 0 && ` (${flagged} flagged)`}
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
