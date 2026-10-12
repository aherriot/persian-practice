import { z } from "zod";
import { auth } from "@/lib/auth";
import { canReviewAudio } from "@/lib/auth/reviewer";
import { REVIEW_REASONS, reviewClip } from "@/lib/audio-store";
import { errorResponse, requireApiKey } from "@/lib/openai";

// A rejection makes the clip again before answering: up to six takes, each listened to twice.
export const maxDuration = 300;

const Body = z.discriminatedUnion("verdict", [
  z.object({ hash: z.string().regex(/^[0-9a-f]{32}$/), verdict: z.literal("approved") }),
  z.object({
    hash: z.string().regex(/^[0-9a-f]{32}$/),
    verdict: z.literal("rejected"),
    reason: z.enum(REVIEW_REASONS),
    note: z.string().trim().max(300).nullable(),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "not signed in" }, { status: 401 });
  if (!canReviewAudio(session.user?.email ?? null)) return Response.json({ error: "not a reviewer" }, { status: 403 });

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid request" }, { status: 400 });
  const { hash, ...review } = body.data;

  if (review.verdict === "rejected") {
    const missingKey = requireApiKey();
    if (missingKey) return missingKey;
  }

  try {
    const result = await reviewClip(hash, userId, review.verdict === "rejected" ? { ...review, note: review.note || null } : review);
    return result ? Response.json(result) : Response.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return errorResponse("audio review", err);
  }
}
