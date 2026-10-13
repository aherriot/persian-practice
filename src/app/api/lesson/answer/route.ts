import { z } from "zod";
import { auth } from "@/lib/auth";
import { EXERCISES } from "@/lib/lesson/check";
import { introduce, recordAnswer } from "@/lib/lesson/store";

const Target = z.object({ kind: z.enum(["lexeme", "pattern"]), id: z.string().min(1).max(100) });

const Body = z.union([
  z.object({ introduce: Target }),
  // What the learner did, not how it went: the answer is marked here (src/lib/lesson/check.ts).
  z.object({
    sentenceId: z.string().min(1).max(100),
    exercise: z.enum(EXERCISES),
    primary: Target.nullable(),
    answer: z.union([z.string().max(500), z.array(z.string().max(100)).max(40)]),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "not signed in" }, { status: 401 });

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid answer" }, { status: 400 });

  if ("introduce" in body.data) {
    await introduce(userId, body.data.introduce);
    return Response.json({ ok: true });
  }
  const result = await recordAnswer(userId, body.data);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });
  return Response.json(result);
}
