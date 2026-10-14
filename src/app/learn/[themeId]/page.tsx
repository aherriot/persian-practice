import { notFound } from "next/navigation";
import { after } from "next/server";
import { ReviewerProvider } from "@/components/Reviewer";
import { canReviewAudio } from "@/lib/auth/reviewer";
import { requireUser } from "@/lib/auth/session";
import { prepareNextSession } from "@/lib/lesson/background";
import { loadSession } from "@/lib/lesson/session";
import { hasSentences } from "@/lib/lesson/store";
import { Session } from "./Session";

export default async function LearnPage({ params }: { params: Promise<{ themeId: string }> }) {
  const user = await requireUser();
  const { themeId } = await params;
  if (!(await hasSentences(user.id, themeId))) notFound();

  const now = new Date();
  const plan = await loadSession(user.id, { themeId, now, seed: now.getTime() % 2 ** 31 });
  // Queued once the page is sent, and written by a worker, so the next session has fresh material waiting.
  after(() => prepareNextSession(user.id));
  return (
    <ReviewerProvider enabled={canReviewAudio(user.email)}>
      <Session plan={plan} href={`/learn/${themeId}`} userId={user.id} />
    </ReviewerProvider>
  );
}
