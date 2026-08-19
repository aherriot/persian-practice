import { and, asc, eq, lte } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { items, userItems } from "@/lib/db/schema";

export const runtime = "nodejs";

/** Items due for this user, oldest-due first. Backs the flashcard fallback UI. */
export async function GET() {
  const user = await requireUser();
  const today = new Date().toISOString().slice(0, 10);

  const due = await db
    .select({
      userItemId: userItems.id,
      itemId: items.id,
      persian: items.persian,
      literary: items.literary,
      gloss: items.gloss,
      transliteration: items.transliteration,
      dueAt: userItems.dueAt,
      repetitions: userItems.repetitions,
    })
    .from(userItems)
    .innerJoin(items, eq(userItems.itemId, items.id))
    .where(and(eq(userItems.userId, user.id), lte(userItems.dueAt, today)))
    .orderBy(asc(userItems.dueAt))
    .limit(20);

  return Response.json({ due });
}
