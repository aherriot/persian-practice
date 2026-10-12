import { z } from "zod";
import { auth } from "@/lib/auth";
import { retireSentence } from "@/lib/lesson/store";

const Body = z.object({ sentenceId: z.string().min(1).max(100) });

/** A learner says a generated sentence is wrong: take it out of circulation. */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "not signed in" }, { status: 401 });

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid report" }, { status: 400 });

  await retireSentence(body.data.sentenceId);
  return Response.json({ ok: true });
}
