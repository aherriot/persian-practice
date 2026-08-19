import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { requireUser } from "@/lib/auth/session";
import { CHAT_MODEL, errorResponse, openai, requireApiKey } from "@/lib/openai";

export const runtime = "nodejs";

const DefinitionSchema = z.object({
  gloss: z.string(),
  transliteration: z.string(),
});

/**
 * On-demand single-word lookup for the tap-to-define UI. Deliberately not
 * backed by the item bank (only ~90 entries, and conjugated/inflected forms in
 * real replies won't match it exactly) — a cheap LLM call handles any word,
 * using the surrounding sentence for disambiguation. The client caches
 * results per word so repeated taps don't re-request.
 */
export async function POST(request: Request) {
  const missingKey = requireApiKey();
  if (missingKey) return missingKey;

  await requireUser();

  const { word, context } = (await request.json()) as { word?: string; context?: string };
  const trimmed = word?.trim();
  if (!trimmed) {
    return Response.json({ error: "word is required" }, { status: 400 });
  }

  try {
    const completion = await openai.chat.completions.parse({
      model: CHAT_MODEL,
      messages: [
        {
          role: "system",
          content: [
            "A learner tapped one Persian word in a conversation with a tutor app.",
            "Give its meaning AS USED IN THIS SENTENCE — a short English gloss (a word or",
            "short phrase, not a full definition) and a Latin transliteration of just that word.",
          ].join("\n"),
        },
        {
          role: "user",
          content: context ? `Word: ${trimmed}\nSentence: ${context}` : `Word: ${trimmed}`,
        },
      ],
      response_format: zodResponseFormat(DefinitionSchema, "definition"),
      max_tokens: 60,
      temperature: 0.3,
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      return Response.json({ error: "no definition returned" }, { status: 502 });
    }
    return Response.json(parsed);
  } catch (err) {
    return errorResponse("define", err);
  }
}
