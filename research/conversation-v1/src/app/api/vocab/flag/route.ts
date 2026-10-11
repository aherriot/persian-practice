import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { corrections, items, turns, userItems } from "@/lib/db/schema";
import { qualityFromOutcome, reviewItem, NEW_ITEM_STATE } from "@/lib/srs";

export const runtime = "nodejs";

// Manually-flagged items aren't placement-tiered, so this is just a
// reasonable middle value — it only affects any future placement-test
// re-run, not review scheduling.
const MANUAL_ITEM_TIER = 4;

/**
 * Self-reported "I had to look this up" for any word tapped in a tutor reply.
 * Treated as equivalent to a recast: it's a cleaner, more reliable miss signal
 * than waiting for the LLM to notice the same gap in a later turn, since the
 * learner is reporting it directly at the moment of confusion.
 */
export async function POST(request: Request) {
  const user = await requireUser();
  const { persian, gloss, transliteration, turnId } = (await request.json()) as {
    persian?: string;
    gloss?: string;
    transliteration?: string;
    turnId?: string;
  };

  if (!persian?.trim() || !gloss?.trim() || !turnId) {
    return Response.json({ error: "persian, gloss, and turnId are required" }, { status: 400 });
  }

  const turn = await db.query.turns.findFirst({ where: eq(turns.id, turnId) });
  if (!turn) {
    return Response.json({ error: "turn not found" }, { status: 404 });
  }

  let item = await db.query.items.findFirst({ where: eq(items.persian, persian) });
  if (!item) {
    const [created] = await db
      .insert(items)
      .values({
        type: "vocab",
        persian,
        gloss,
        transliteration: transliteration ?? null,
        tier: MANUAL_ITEM_TIER,
        tags: [],
      })
      .returning();
    item = created;
  }

  const quality = qualityFromOutcome("recast")!;
  const existing = await db.query.userItems.findFirst({
    where: and(eq(userItems.userId, user.id), eq(userItems.itemId, item.id)),
  });
  const update = reviewItem(existing ?? NEW_ITEM_STATE, quality);

  if (existing) {
    await db
      .update(userItems)
      .set({
        intervalDays: update.intervalDays,
        easeFactor: update.easeFactor,
        repetitions: update.repetitions,
        lapses: update.lapses,
        dueAt: update.dueAt.toISOString().slice(0, 10),
        lastReviewedAt: update.lastReviewedAt,
      })
      .where(eq(userItems.id, existing.id));
  } else {
    await db.insert(userItems).values({
      userId: user.id,
      itemId: item.id,
      intervalDays: update.intervalDays,
      easeFactor: update.easeFactor,
      repetitions: update.repetitions,
      lapses: update.lapses,
      dueAt: update.dueAt.toISOString().slice(0, 10),
      lastReviewedAt: update.lastReviewedAt,
      source: "manual",
    });
  }

  await db.insert(corrections).values({
    turnId,
    itemId: item.id,
    outcome: "recast",
    note: "self-reported: looked up",
  });

  return Response.json({ ok: true, dueAt: update.dueAt });
}
