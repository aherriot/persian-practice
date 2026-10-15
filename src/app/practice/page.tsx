import { after } from "next/server";
import { ReviewerProvider } from "@/components/Reviewer";
import { canReviewAudio } from "@/lib/auth/reviewer";
import { requireUser } from "@/lib/auth/session";
import { prepareNextSession } from "@/lib/lesson/background";
import { loadSession } from "@/lib/lesson/session";
import { Session } from "../learn/[themeId]/Session";

/**
 * Practice across every theme at once: what the learner keeps getting wrong
 * first, then whatever else is due, wherever it was learned, and new material
 * from the earliest unfinished theme — the learner's own words come first.
 * Room for more review than a theme's session; as much new material, and more
 * for a learner getting nearly everything right (src/lib/lesson/pace.ts).
 */
export default async function PracticePage() {
  const user = await requireUser();
  const now = new Date();
  const plan = await loadSession(user.id, { now, seed: now.getTime() % 2 ** 31, maxReview: 12 });
  // Queued once the page is sent, and written by a worker, so the next session has fresh material waiting.
  after(() => prepareNextSession(user.id));
  return (
    <ReviewerProvider enabled={canReviewAudio(user.email)}>
      <Session plan={plan} href="/practice" userId={user.id} />
    </ReviewerProvider>
  );
}
