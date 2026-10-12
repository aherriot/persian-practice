import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { draftWord } from "@/lib/lesson/author";
import { loadAllContent } from "@/lib/lesson/store";
import { addWord, findExisting, prepareWord, removeWord, validateWord } from "@/lib/lesson/words";
import { errorResponse, requireApiKey } from "@/lib/openai";

const Person = z.enum(["1sg", "2sg", "3sg", "1pl", "2pl", "3pl"]);
const text = (max: number) => z.string().max(max);

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft"), input: text(80).min(1), hint: text(200).nullable() }),
  z.object({
    action: z.literal("save"),
    entry: z.object({
      fa: text(60),
      voc: text(120),
      translit: text(80),
      gloss: text(80),
      literary: text(60).nullable(),
      lemma: text(60).nullable(),
      verbPerson: Person.nullable(),
      subjectPronoun: Person.nullable(),
      note: text(300).nullable(),
    }),
  }),
  z.object({ action: z.literal("remove"), id: text(100).min(1) }),
]);

/** How many curated entries the author is shown as a style guide. */
const STYLE_EXAMPLES = 10;

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "not signed in" }, { status: 401 });

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid request" }, { status: 400 });
  const data = body.data;

  try {
    if (data.action === "draft") {
      const missingKey = requireApiKey();
      if (missingKey) return missingKey;
      const content = await loadAllContent(userId);
      const examples = [...content.lexemes.values()].filter((l) => !l.ownerId).slice(0, STYLE_EXAMPLES);
      const draft = await draftWord(data.input, data.hint, examples);
      if (!draft.understood) return Response.json({ error: "I could not tell which word that is. Try another spelling, or add what it means." }, { status: 422 });
      const existing = await findExisting(userId, draft.fa);
      return Response.json({ draft, existing });
    }

    if (data.action === "save") {
      const problems = validateWord(data.entry);
      if (problems.length > 0) return Response.json({ error: problems.join(" ") }, { status: 422 });
      const existing = await findExisting(userId, data.entry.fa);
      if (existing) return Response.json({ error: `${existing.fa} ("${existing.gloss}") is already in your reference.` }, { status: 409 });
      const id = await addWord(userId, data.entry);
      // Audio and example sentences take a while; the word is usable without them.
      after(() => prepareWord(userId, id).catch((err) => console.error("prepareWord", err)));
      return Response.json({ id });
    }

    const removed = await removeWord(userId, data.id);
    return removed ? Response.json({ ok: true }) : Response.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return errorResponse("words", err);
  }
}
