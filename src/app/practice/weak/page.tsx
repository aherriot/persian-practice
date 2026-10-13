import Link from "next/link";
import { AudioReviewProvider } from "@/components/AudioReview";
import { canReviewAudio } from "@/lib/auth/reviewer";
import { requireUser } from "@/lib/auth/session";
import { loadSession } from "@/lib/lesson/session";
import { loadKnowledge } from "@/lib/lesson/store";
import { WEAK_SESSION, weakTargets } from "@/lib/lesson/weak";
import { Session } from "../../learn/[themeId]/Session";

/**
 * A session about the learner's weak words and grammar (defined in
 * lib/lesson/weak.ts), whether or not they are due, with nothing new.
 *
 * Answers are scheduled by the usual rules, on purpose. A right answer moves a
 * word on only if it was due: getting it right an hour after getting it wrong
 * is practice, not evidence it will be remembered next week, and counting it
 * would let a few minutes of cramming push the word out of sight. A wrong
 * answer counts whenever it happens, because it is evidence at any time.
 */
export default async function WeakPracticePage() {
  const user = await requireUser();
  const now = new Date();
  const weak = weakTargets(await loadKnowledge(user.id));

  if (weak.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-6 bg-paper px-5 py-6 text-center">
        <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">Nothing weak</h1>
        <p className="max-w-xs text-sm leading-relaxed text-ink/70">
          Everything you have got wrong, you have since got right three times running. Words you miss in future will
          collect here.
        </p>
        <div className="flex items-center gap-6">
          <Link href="/practice" className="text-sm font-medium text-cobalt underline">
            Practise everything
          </Link>
          <Link href="/dashboard" className="text-sm text-ink/60 underline">
            Back
          </Link>
        </div>
      </main>
    );
  }

  const plan = await loadSession(user.id, {
    now,
    seed: now.getTime() % 2 ** 31,
    maxNew: 0,
    maxReview: WEAK_SESSION,
    review: weak,
  });
  return (
    <AudioReviewProvider enabled={canReviewAudio(user.email)}>
      <Session plan={plan} href="/practice/weak" userId={user.id} />
    </AudioReviewProvider>
  );
}
