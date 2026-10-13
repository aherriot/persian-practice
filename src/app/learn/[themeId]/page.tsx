import { notFound } from "next/navigation";
import { after } from "next/server";
import { AudioReviewProvider } from "@/components/AudioReview";
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
  // Written after the page is sent, so the next session has fresh material waiting.
  after(() => prepareNextSession(user.id));
  return (
    <AudioReviewProvider enabled={canReviewAudio(user.email)}>
      <Session plan={plan} href={`/learn/${themeId}`} userId={user.id} />
    </AudioReviewProvider>
  );
}
