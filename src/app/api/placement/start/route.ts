import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { items, placementSessions } from "@/lib/db/schema";
import { startPlacement } from "@/lib/placement";

export const runtime = "nodejs";

async function pickItemForTier(tier: number, excludeItemIds: string[]) {
  const candidates = await db.query.items.findMany({ where: eq(items.tier, tier) });
  const pool = candidates.filter((i) => !excludeItemIds.includes(i.id));
  const usable = pool.length > 0 ? pool : candidates; // fall back to reuse if a tier is exhausted
  if (usable.length === 0) return null;
  return usable[Math.floor(Math.random() * usable.length)];
}

export async function POST() {
  const user = await requireUser();
  const bounds = startPlacement();

  const item = await pickItemForTier(bounds.currentTier, []);
  if (!item) {
    return Response.json({ error: "item bank is empty for this tier" }, { status: 500 });
  }

  const [session] = await db
    .insert(placementSessions)
    .values({
      userId: user.id,
      status: "in_progress",
      currentTier: bounds.currentTier,
      lowTier: bounds.lowTier,
      highTier: bounds.highTier,
      exchangeCount: bounds.exchangeCount,
    })
    .returning();

  return Response.json({
    sessionId: session.id,
    itemId: item.id,
    persian: item.persian,
    tier: bounds.currentTier,
    exchangeCount: bounds.exchangeCount,
  });
}
