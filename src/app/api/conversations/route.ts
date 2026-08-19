import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { conversations, topics, turns, users } from "@/lib/db/schema";
import { generateScenario } from "@/lib/conversation";
import { REVIEW_SITUATION } from "@/lib/prompt";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await requireUser();
  const { topicId, mode } = (await request.json()) as {
    topicId?: string;
    mode?: "topic" | "review";
  };

  if (mode !== "topic" && mode !== "review") {
    return Response.json({ error: "mode must be 'topic' or 'review'" }, { status: 400 });
  }

  const dbUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });

  let scenario = REVIEW_SITUATION;
  let boundTopicId: string | null = null;

  if (mode === "topic") {
    if (!topicId) {
      return Response.json({ error: "topicId is required for mode 'topic'" }, { status: 400 });
    }
    const topic = await db.query.topics.findFirst({
      where: eq(topics.id, topicId),
    });
    if (!topic || topic.userId !== user.id) {
      return Response.json({ error: "topic not found" }, { status: 404 });
    }
    scenario = await generateScenario(topic.rawText, dbUser?.level ?? null);
    boundTopicId = topic.id;
    await db.update(topics).set({ lastUsedAt: new Date() }).where(eq(topics.id, topic.id));
  }

  const [conversation] = await db
    .insert(conversations)
    .values({
      userId: user.id,
      topicId: boundTopicId,
      mode,
      scenario: { ...scenario, openerTransliteration: scenario.openerTransliteration ?? "" },
    })
    .returning();

  const [openerTurn] = await db
    .insert(turns)
    .values({
      conversationId: conversation.id,
      role: "assistant",
      content: scenario.opener,
      transliteration: scenario.openerTransliteration ?? null,
      seq: 0,
    })
    .returning();

  return Response.json({ conversationId: conversation.id, scenario, openerTurn });
}
