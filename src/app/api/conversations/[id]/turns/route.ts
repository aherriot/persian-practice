import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { requireUser } from "@/lib/auth/session";
import { CHAT_MODEL, errorResponse, openai, requireApiKey } from "@/lib/openai";
import { db } from "@/lib/db";
import { conversations, topics, turns, users } from "@/lib/db/schema";
import { applySrsOutcome, recentMistakes, selectPromptItems } from "@/lib/conversation";
import { buildConversationSystemPrompt, REGISTER_REMINDER, type ConversationContext } from "@/lib/prompt";

export const runtime = "nodejs";

const TurnReplySchema = z.object({
  reply: z.string(),
  /** Latin transliteration of `reply`, e.g. "salâm, chetori?" — for a learner struggling to read the script. */
  transliteration: z.string(),
  items_used: z.array(
    z.object({
      ref: z.number(),
      outcome: z.enum(["correct", "recast", "not_attempted"]),
    }),
  ),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const missingKey = requireApiKey();
  if (missingKey) return missingKey;

  const user = await requireUser();
  const { id: conversationId } = await params;

  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });
  if (!conversation || conversation.userId !== user.id) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (conversation.endedAt) {
    return Response.json({ error: "conversation has ended" }, { status: 400 });
  }

  const { message } = (await request.json()) as { message?: string };
  const trimmed = message?.trim();
  if (!trimmed) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  try {
    const existingTurns = await db
      .select()
      .from(turns)
      .where(eq(turns.conversationId, conversationId))
      .orderBy(asc(turns.seq));
    const nextSeq = existingTurns.length > 0 ? existingTurns[existingTurns.length - 1].seq + 1 : 0;

    const [userTurn] = await db
      .insert(turns)
      .values({ conversationId, role: "user", content: trimmed, seq: nextSeq })
      .returning();

    const dbUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    const topic = conversation.topicId
      ? await db.query.topics.findFirst({ where: eq(topics.id, conversation.topicId) })
      : undefined;

    const { promptItems, refToItemId } = await selectPromptItems(user.id, topic?.tags ?? []);
    const mistakes = await recentMistakes(user.id);

    const scenario = conversation.scenario ?? {
      id: "review",
      title: "Catching up",
      goal: "Have a relaxed catch-up conversation",
      situation: "You are a friend catching up with the learner.",
      opener: "سلام!",
      openerTransliteration: "salâm!",
    };

    const ctx: ConversationContext = {
      scenario,
      level: dbUser?.level ?? null,
      dueItems: promptItems,
      recentMistakes: mistakes,
    };

    const systemPrompt = buildConversationSystemPrompt(ctx, { maxSentences: 2 });
    const history = [...existingTurns, userTurn].map((t) => ({
      role: t.role,
      content: t.content,
    }));

    const completion = await openai.chat.completions.parse({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "system", content: REGISTER_REMINDER },
      ],
      response_format: zodResponseFormat(TurnReplySchema, "turn_reply"),
      max_tokens: 300,
      temperature: 0.8,
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed || !parsed.reply.trim()) {
      return Response.json({ error: "model returned an empty reply" }, { status: 502 });
    }

    const [assistantTurn] = await db
      .insert(turns)
      .values({
        conversationId,
        role: "assistant",
        content: parsed.reply,
        transliteration: parsed.transliteration,
        seq: nextSeq + 1,
      })
      .returning();

    const itemEvents: { persian: string; gloss: string; outcome: string }[] = [];
    for (const event of parsed.items_used) {
      if (event.outcome === "not_attempted") continue;
      const itemId = refToItemId.get(event.ref);
      if (!itemId) continue; // model invented a ref not in the offered list — ignore rather than trust it
      await applySrsOutcome(user.id, itemId, assistantTurn.id, event.outcome);
      const promptItem = promptItems.find((p) => p.ref === event.ref);
      if (promptItem) itemEvents.push({ ...promptItem, outcome: event.outcome });
    }

    return Response.json({ reply: parsed.reply, transliteration: parsed.transliteration, itemEvents });
  } catch (err) {
    return errorResponse("conversation-turn", err);
  }
}
