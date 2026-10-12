import { z } from "zod";
import { auth } from "@/lib/auth";
import { audioUrl } from "@/lib/audio-key";
import { sentenceClip } from "@/lib/lesson/plan";
import { loadExamples } from "@/lib/lesson/store";
import type { ReferenceExample } from "@/app/reference/Reference";

const Query = z.object({ kind: z.enum(["lexeme", "pattern"]), id: z.string().min(1).max(100) });

const MAX_EXAMPLES = 3;

/** The example sentences for one reference entry, fetched when it is opened. */
export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "not signed in" }, { status: 401 });

  const query = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "invalid request" }, { status: 400 });

  const sentences = await loadExamples(userId, query.data, MAX_EXAMPLES);
  const examples: ReferenceExample[] = sentences.map((s) => ({
    id: s.id,
    voc: s.tokens.map((t) => t.voc + (t.after ?? "")).join(" ") + s.endPunct,
    translit: s.tokens.map((t) => t.translit + (t.after ? "," : "")).join(" "),
    english: s.english,
    audioUrl: audioUrl(sentenceClip(s)),
    generated: s.generated,
  }));
  return Response.json({ examples });
}
