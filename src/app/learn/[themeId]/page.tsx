import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { planSession } from "@/lib/lesson/plan";
import { loadKnowledge, loadTheme } from "@/lib/lesson/store";
import { Session } from "./Session";

export default async function LearnPage({ params }: { params: Promise<{ themeId: string }> }) {
  const user = await requireUser();
  const { themeId } = await params;
  const [content, knowledge] = await Promise.all([loadTheme(themeId), loadKnowledge(user.id)]);
  if (!content) notFound();

  const now = new Date();
  const plan = planSession(content, knowledge, { now, seed: now.getTime() % 2 ** 31 });
  return <Session plan={plan} themeId={themeId} />;
}
