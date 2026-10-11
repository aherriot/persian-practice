import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { userItems } from "@/lib/db/schema";
import { reviewItem, type Quality } from "@/lib/srs";

export const runtime = "nodejs";

/** Self-graded flashcard review: correct -> quality 5, incorrect -> quality 2. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userItemId: string }> },
) {
  const user = await requireUser();
  const { userItemId } = await params;

  const { correct } = (await request.json()) as { correct?: boolean };
  if (typeof correct !== "boolean") {
    return Response.json({ error: "correct (boolean) is required" }, { status: 400 });
  }

  const existing = await db.query.userItems.findFirst({
    where: and(eq(userItems.id, userItemId), eq(userItems.userId, user.id)),
  });
  if (!existing) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const quality: Quality = correct ? 5 : 2;
  const update = reviewItem(
    {
      intervalDays: existing.intervalDays,
      easeFactor: existing.easeFactor,
      repetitions: existing.repetitions,
      lapses: existing.lapses,
    },
    quality,
  );

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
    .where(eq(userItems.id, userItemId));

  return Response.json({ dueAt: update.dueAt, intervalDays: update.intervalDays });
}
