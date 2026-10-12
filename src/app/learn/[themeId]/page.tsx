import { notFound } from "next/navigation";
import { after } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { prepareNextSession } from "@/lib/lesson/background";
import { planSession } from "@/lib/lesson/plan";
import { loadKnowledge, loadSeen, loadTheme } from "@/lib/lesson/store";
import { Session } from "./Session";

export default async function LearnPage({ params }: { params: Promise<{ themeId: string }> }) {
  const user = await requireUser();
  const { themeId } = await params;
  const [content, knowledge, seen] = await Promise.all([
    loadTheme(themeId, user.id),
    loadKnowledge(user.id),
    loadSeen(user.id),
  ]);
  if (!content) notFound();

  const now = new Date();
  const plan = planSession(content, knowledge, { now, seed: now.getTime() % 2 ** 31, seen });
  // Written after the page is sent, so the next session has fresh material waiting.
  after(() => prepareNextSession(user.id));
  return <Session plan={plan} href={`/learn/${themeId}`} />;
}
