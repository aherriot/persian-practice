import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { conversations, turns } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const conversation = await db.query.conversations.findFirst({ where: eq(conversations.id, id) });
  if (!conversation || conversation.userId !== user.id) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(turns)
    .where(eq(turns.conversationId, id))
    .orderBy(asc(turns.seq));

  return Response.json({ conversation, turns: rows });
}
