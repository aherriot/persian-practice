import { z } from "zod";
import { auth } from "@/lib/auth";
import { introduce, recordAnswer } from "@/lib/lesson/store";

const Target = z.object({ kind: z.enum(["lexeme", "pattern"]), id: z.string().min(1).max(100) });

const Body = z.union([
  z.object({ introduce: Target }),
  z.object({
    sentenceId: z.string().min(1).max(100),
    exercise: z.string().min(1).max(30),
    correct: z.boolean(),
    primary: Target.nullable(),
    others: z.array(Target).max(30),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "not signed in" }, { status: 401 });

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid answer" }, { status: 400 });

  if ("introduce" in body.data) await introduce(userId, body.data.introduce);
  else await recordAnswer(userId, body.data);
  return Response.json({ ok: true });
}
