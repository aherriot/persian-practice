import { after } from "next/server";
import { ReviewerProvider } from "@/components/Reviewer";
import { canReviewAudio } from "@/lib/auth/reviewer";
import { requireUser } from "@/lib/auth/session";
import { prepareNextSession } from "@/lib/lesson/background";
import { loadSession } from "@/lib/lesson/session";
import { Session } from "../learn/[themeId]/Session";

/**
 * Practice across every theme at once: whatever is due comes first, wherever
 * it was learned, and new material continues from the earliest unfinished
 * theme. Weighted towards review, since that is what this mode is for.
 */
export default async function PracticePage() {
  const user = await requireUser();
  const now = new Date();
  const plan = await loadSession(user.id, { now, seed: now.getTime() % 2 ** 31, maxNew: 2, maxReview: 12 });
  // Queued once the page is sent, and written by a worker, so the next session has fresh material waiting.
  after(() => prepareNextSession(user.id));
  return (
    <ReviewerProvider enabled={canReviewAudio(user.email)}>
      <Session plan={plan} href="/practice" userId={user.id} />
    </ReviewerProvider>
  );
}
