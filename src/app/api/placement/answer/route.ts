import { and, eq, lte } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { items, placementResponses, placementSessions, userItems, users } from "@/lib/db/schema";
import { gradeAnswer, nextStep, resultTier, tierToLevel, type PlacementBounds } from "@/lib/placement";
import { placementSeedState } from "@/lib/srs";

export const runtime = "nodejs";

async function pickItemForTier(tier: number, excludeItemIds: string[]) {
  const candidates = await db.query.items.findMany({ where: eq(items.tier, tier) });
  const pool = candidates.filter((i) => !excludeItemIds.includes(i.id));
  const usable = pool.length > 0 ? pool : candidates;
  if (usable.length === 0) return null;
  return usable[Math.floor(Math.random() * usable.length)];
}

export async function POST(request: Request) {
  const user = await requireUser();
  const { sessionId, itemId, answer } = (await request.json()) as {
    sessionId?: string;
    itemId?: string;
    answer?: string;
  };
  if (!sessionId || !itemId || typeof answer !== "string") {
    return Response.json({ error: "sessionId, itemId, answer are required" }, { status: 400 });
  }

  const session = await db.query.placementSessions.findFirst({
    where: and(eq(placementSessions.id, sessionId), eq(placementSessions.userId, user.id)),
  });
  if (!session || session.status !== "in_progress") {
    return Response.json({ error: "no in-progress placement session" }, { status: 404 });
  }

  const item = await db.query.items.findFirst({ where: eq(items.id, itemId) });
  if (!item || item.tier !== session.currentTier) {
    return Response.json({ error: "item does not match the current exchange" }, { status: 400 });
  }

  const correct = gradeAnswer(answer, item.gloss, item.transliteration);
  const priorResponses = await db.query.placementResponses.findMany({
    where: eq(placementResponses.placementSessionId, session.id),
  });

  await db.insert(placementResponses).values({
    placementSessionId: session.id,
    itemId: item.id,
    tier: session.currentTier,
    correct,
    seq: priorResponses.length,
  });

  const bounds: PlacementBounds = {
    lowTier: session.lowTier,
    highTier: session.highTier,
    currentTier: session.currentTier,
    exchangeCount: session.exchangeCount,
  };
  const step = nextStep(bounds, correct);

  if (step.done) {
    const tier = resultTier(step.bounds);
    const level = tierToLevel(tier);

    await db
      .update(placementSessions)
      .set({
        status: "complete",
        currentTier: step.bounds.currentTier,
        lowTier: step.bounds.lowTier,
        highTier: step.bounds.highTier,
        exchangeCount: step.bounds.exchangeCount,
        resultLevel: level,
        completedAt: new Date(),
      })
      .where(eq(placementSessions.id, session.id));

    await db.update(users).set({ level }).where(eq(users.id, user.id));

    if (tier > 0) {
      const seedable = await db.query.items.findMany({ where: lte(items.tier, tier) });
      const seed = placementSeedState();
      if (seedable.length > 0) {
        await db
          .insert(userItems)
          .values(
            seedable.map((seedItem) => ({
              userId: user.id,
              itemId: seedItem.id,
              intervalDays: seed.intervalDays,
              easeFactor: seed.easeFactor,
              repetitions: seed.repetitions,
              lapses: seed.lapses,
              dueAt: seed.dueAt.toISOString().slice(0, 10),
              lastReviewedAt: seed.lastReviewedAt,
              source: "placement" as const,
            })),
          )
          .onConflictDoNothing({ target: [userItems.userId, userItems.itemId] });
      }
    }

    return Response.json({ completed: true, tier, level });
  }

  await db
    .update(placementSessions)
    .set({
      currentTier: step.bounds.currentTier,
      lowTier: step.bounds.lowTier,
      highTier: step.bounds.highTier,
      exchangeCount: step.bounds.exchangeCount,
    })
    .where(eq(placementSessions.id, session.id));

  const usedItemIds = [...priorResponses.map((r) => r.itemId), item.id].filter(
    (id): id is string => Boolean(id),
  );
  const nextItem = await pickItemForTier(step.bounds.currentTier, usedItemIds);
  if (!nextItem) {
    return Response.json({ error: "item bank is empty for this tier" }, { status: 500 });
  }

  return Response.json({
    completed: false,
    sessionId: session.id,
    itemId: nextItem.id,
    persian: nextItem.persian,
    tier: step.bounds.currentTier,
    exchangeCount: step.bounds.exchangeCount,
  });
}
