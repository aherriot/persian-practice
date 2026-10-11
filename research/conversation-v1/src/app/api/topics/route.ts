import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { topics } from "@/lib/db/schema";
import { deriveTopicTags } from "@/lib/conversation";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireUser();
  const rows = await db.query.topics.findMany({
    where: eq(topics.userId, user.id),
    orderBy: desc(topics.lastUsedAt),
    limit: 20,
  });
  return Response.json({ topics: rows });
}

export async function POST(request: Request) {
  const user = await requireUser();
  const { rawText } = (await request.json()) as { rawText?: string };
  const trimmed = rawText?.trim();
  if (!trimmed) {
    return Response.json({ error: "rawText is required" }, { status: 400 });
  }

  const tags = await deriveTopicTags(trimmed);

  const [topic] = await db
    .insert(topics)
    .values({ userId: user.id, rawText: trimmed, tags })
    .returning();

  return Response.json({ topic });
}
