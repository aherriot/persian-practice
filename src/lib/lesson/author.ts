import { z } from "zod";
import { openai } from "@/lib/openai";
import type { SentenceDraft } from "./assemble";
import { FORM_HELP, FORMS, formsFor, FORM_PATTERN, type Form } from "./forms";
import type { Lexeme, Person } from "./types";

/**
 * The LLM as content author. It is only ever called ahead of time — when
 * sentences run low or a word is added — and never while a lesson is being
 * answered. Everything it writes is checked before a learner sees it.
 */
export const CONTENT_MODEL = process.env.OPENAI_CONTENT_MODEL ?? "gpt-5.5";

const AUTHOR_TIMEOUT_MS = 5 * 60_000;

async function askJson<T extends z.ZodType>(name: string, schema: T, system: string, user: string): Promise<z.infer<T>> {
  const response = await openai.chat.completions.create(
    {
      model: CONTENT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name, strict: true, schema: z.toJSONSchema(schema) as Record<string, unknown> },
      },
    },
    // Authoring runs in the background and the model thinks before it writes;
    // the client's default one-minute limit is too short for a batch.
    { timeout: AUTHOR_TIMEOUT_MS },
  );
  return schema.parse(JSON.parse(response.choices[0]?.message.content ?? "null"));
}

const REGISTER = `The Persian is everyday spoken Tehrani, the way people actually talk at home, in a shop or with friends — not book Persian. The verb comes last. A subject pronoun is left out unless it adds emphasis or contrast.`;

// --- Sentences ---

const Drafts = z.object({
  sentences: z.array(
    z.object({
      english: z.string(),
      kind: z.enum(["statement", "yes-no-question", "wh-question"]),
      tokens: z.array(z.object({ word: z.string(), form: z.enum(FORMS), comma: z.boolean() })),
    }),
  ),
});

export type AuthorRequest = {
  /** Words the sentences may use. */
  words: Lexeme[];
  /** Pattern ids the learner knows; forms and questions that need others are off limits. */
  patterns: Set<string>;
  /** Word ids that each sentence should feature at least one of. */
  focus: string[];
  /** Persian text of sentences that already exist, so they are not repeated. */
  existing: string[];
  count: number;
  /** The learner knows these words well: ask for sentences that make them work harder. */
  stretch: boolean;
};

export async function draftSentences(request: AuthorRequest): Promise<SentenceDraft[]> {
  const allowedForms = (lexeme: Lexeme): Form[] =>
    formsFor(lexeme).filter((form) => {
      const pattern = FORM_PATTERN[form];
      return !pattern || request.patterns.has(pattern);
    });
  const usedForms = new Set(request.words.flatMap(allowedForms).filter((form) => form !== "base"));

  const system = `You write practice sentences for an adult learning spoken Tehrani Persian. ${REGISTER}

Rules:
- Use ONLY the words in the list, referring to each by its id. Never use a word that is not in the list, however common it is.
- A word may only take the forms listed for it. "base" is the word as given.${[...usedForms].map((form) => `\n  - "${form}": ${FORM_HELP[form as Exclude<Form, "base">]}`).join("")}
- Write things a person would really say. Each sentence must be natural, grammatical and make sense on its own. If the words do not allow a natural sentence, write fewer sentences rather than a strange one.
- ${request.stretch ? "The learner already knows these words well, so do not write the shortest possible sentence. Write 4 to 7 words each, and make each sentence do more than one thing: combine two ideas, use several of the grammar forms together, give an answer with a reason or a contrast, ask a fuller question." : "2 to 6 words each."} Vary the structure; do not just swap one noun for another.
- kind: "statement"${request.patterns.has("question") ? ', "yes-no-question" (the same words as a statement, asked with rising intonation)' : ""}, or "wh-question" (only if the list has a question word).
- comma: true when a comma follows that word, as after an opening "yes", "no" or greeting.
- english: a natural English translation of exactly what the Persian says.
- Do not repeat a sentence that already exists.`;

  const user = `Words (id — Persian — pronunciation — meaning — forms allowed):
${request.words.map((w) => `${w.id} — ${w.fa} — ${w.translit} — ${w.gloss} — ${allowedForms(w).join(", ")}`).join("\n")}

Every sentence must include at least one of these words: ${request.focus.join(", ")}

Sentences that already exist:
${request.existing.join("\n") || "(none)"}

Write up to ${request.count} new sentences.`;

  return (await askJson("sentences", Drafts, system, user)).sentences;
}

// --- Review ---

const Verdicts = z.object({
  verdicts: z.array(z.object({ number: z.number(), natural: z.boolean(), englishCorrect: z.boolean(), problem: z.string() })),
});

/**
 * A second opinion on generated sentences, from a fresh call that did not
 * write them. Returns, per sentence, whether it may be kept. A sentence the
 * reviewer does not mention is not kept.
 */
export async function reviewSentences(
  candidates: { persian: string; translit: string; english: string; newWord?: string }[],
): Promise<{ keep: boolean; problem: string }[]> {
  if (candidates.length === 0) return [];
  const system = `You are a native Tehrani speaker reviewing sentences for a beginner's Persian course. ${REGISTER}

For each numbered sentence decide:
- natural: would a native speaker really say this, in this spoken register, with correct grammar and a sensible meaning? Beginner sentences are short and simple, and that is fine. Reject wrong grammar, book-Persian phrasing, odd word order, and sentences that are grammatical but that nobody would say.
- englishCorrect: is the English an accurate translation?
- If a line names a new word being taught, also reject it (natural: false) when that word's spelling, pronunciation or meaning is wrong, or when it is a book form rather than what Tehranis say.
- problem: a few words on what is wrong, or "" if nothing is.
Be strict. A wrong sentence taught to a learner is far worse than a rejected good one.`;
  const user = candidates
    .map((c, i) => `${i + 1}. ${c.persian}  (${c.translit})  =  ${c.english}${c.newWord ? `   [new word: ${c.newWord}]` : ""}`)
    .join("\n");

  const { verdicts } = await askJson("review", Verdicts, system, user);
  return candidates.map((_, i) => {
    const verdict = verdicts.find((v) => v.number === i + 1);
    return { keep: Boolean(verdict?.natural && verdict.englishCorrect), problem: verdict?.problem ?? "not reviewed" };
  });
}

// --- Words ---

const PERSONS = ["1sg", "2sg", "3sg", "1pl", "2pl", "3pl"] as const satisfies readonly Person[];

const wordFields = {
  fa: z.string(),
  voc: z.string(),
  translit: z.string(),
  gloss: z.string(),
  literary: z.string().nullable(),
  lemma: z.string().nullable(),
  verbPerson: z.enum(PERSONS).nullable(),
  subjectPronoun: z.enum(PERSONS).nullable(),
  note: z.string().nullable(),
};
const WordDraft = z.object({ understood: z.boolean(), ...wordFields });
export type WordDraft = z.infer<typeof WordDraft>;

const WORD_FIELDS = `- fa: the SPOKEN Tehrani form in Persian script, without vowel marks, spelled the way Iranians write it informally (نون, not نان; می‌خوام, not می‌خواهم). Use a half-space (ZWNJ) where Persian spelling needs one.
- voc: exactly the same letters as fa, with the short-vowel marks (fatha, kasra, damma) added where a learner needs them. Do not add or change any letter.
- translit: pronunciation in Latin letters. Use â for the long a of "father", a for the short a of "cat", and e, o, i, u, kh, gh, sh, ch, zh. Lowercase.
- gloss: a short English meaning, as in a pocket dictionary. For a verb form say who does it ("I go", "you have").
- literary: the book or formal form in Persian script if it differs from fa, else null.
- lemma: for an inflected verb form, the infinitive in Persian script; else null.
- verbPerson: for a verb form, who its ending marks (1sg, 2sg, 3sg, 1pl, 2pl, 3pl); else null.
- subjectPronoun: for a subject pronoun, its person; else null.
- note: one short sentence a learner would want (a usage point, a trap, a literal meaning), or null.`;

/** Drafts a dictionary entry from whatever the learner typed: Persian, a transliteration, or English. */
export async function draftWord(input: string, hint: string | null, examples: Lexeme[]): Promise<WordDraft> {
  const system = `You write dictionary entries for an adult learning spoken Tehrani Persian. The learner gives a word or short phrase they met in real life — in Persian script, in Latin letters as they heard it, or in English — and you write the entry for the form Tehranis actually say.

Fields:
- understood: false if you cannot tell what word is meant. Then leave the other strings empty.
${WORD_FIELDS}

If the learner gives a verb as an infinitive or in English ("to go"), give the first person singular present, since that is what they will say first.

Entries already in the course, for style:
${examples.map((w) => `${w.fa} | ${w.voc} | ${w.translit} | ${w.gloss}`).join("\n")}`;
  const user = hint ? `${input}\n\nWhat the learner says it means or where they heard it: ${hint}` : input;
  return askJson("word", WordDraft, system, user);
}

// --- New material ---

const Expansion = z.object({
  items: z.array(
    z.object({
      ...wordFields,
      sentence: z.object({
        english: z.string(),
        kind: z.enum(["statement", "yes-no-question", "wh-question"]),
        tokens: z.array(z.object({ word: z.string(), form: z.enum(FORMS), comma: z.boolean() })),
      }),
    }),
  ),
});
export type ExpansionItem = z.infer<typeof Expansion>["items"][number];

/** The id a draft uses for its own new word, before that word has a real one. */
export const NEW_WORD = "NEW";

export type ExpansionRequest = {
  /** Words the learner knows, which the teaching sentences are built from. */
  known: Lexeme[];
  /** The rest of what they know, when that is too much to list in full: not to be taught again. */
  alsoKnown: Lexeme[];
  /** Words already in the course but not yet met; not to be taught again and not usable in sentences. */
  upcoming: Lexeme[];
  patterns: Set<string>;
  /** Titles of the themes the learner studies, and glosses of words they added themselves: what they care about. */
  interests: string[];
  count: number;
};

/**
 * Chooses what a learner who has run out of material should learn next, one
 * word at a time, each with the sentence that will introduce it.
 */
export async function draftExpansion(request: ExpansionRequest): Promise<ExpansionItem[]> {
  const allowedForms = (lexeme: Lexeme): Form[] =>
    formsFor(lexeme).filter((form) => {
      const pattern = FORM_PATTERN[form];
      return !pattern || request.patterns.has(pattern);
    });
  const usedForms = new Set(request.known.flatMap(allowedForms).filter((form) => form !== "base"));

  const system = `You plan the next steps for an adult learning spoken Tehrani Persian. They know the words listed${request.alsoKnown.length > 0 ? ", and many more besides," : ""} and are ready for more. ${REGISTER}

Choose the new words that would let them say the most new things, in the order they should be learned. Push them forward:
- Do not just add more nouns of a kind they already have. Prefer what opens up new sentences: verbs they lack, the verbs they have in persons and tenses they lack (each inflected form is its own word: "I bought", "you want", "he has"), question words, connectors (but, because, or), words for time, place, quantity and feeling, and everyday set phrases.
- Stay close to what they study and care about, then widen out to ordinary daily life.
- One word or fixed phrase per item. Never a word they already know or one that is already in the course.

For each new word write the entry:
${WORD_FIELDS}

And one sentence that introduces it:
- It uses the new word exactly once, written as the id "${NEW_WORD}", and otherwise ONLY words from the list that have an id, by id. Never any other word.
- A word may only take the forms listed for it; the new word is always "base".${[...usedForms].map((form) => `\n  - "${form}": ${FORM_HELP[form as Exclude<Form, "base">]}`).join("")}
- 2 to 6 words, natural, something a person would really say, and clear enough that the new word's meaning shows.
- kind: "statement"${request.patterns.has("question") ? ', "yes-no-question" (rising intonation)' : ""} or "wh-question" (only with a question word).
- comma: true when a comma follows that word.
- english: a natural translation of exactly what the Persian says.
If no natural sentence can be made for a word with what they know, choose a different word.`;

  const user = `Words the learner knows (id — Persian — pronunciation — meaning — forms allowed):
${request.known.map((w) => `${w.id} — ${w.fa} — ${w.translit} — ${w.gloss} — ${allowedForms(w).join(", ")}`).join("\n")}
${request.alsoKnown.length > 0 ? `\nThey also know these (do not teach, do not use):\n${request.alsoKnown.map((w) => w.fa).join("، ")}\n` : ""}
Already in the course, coming later (do not teach, do not use):
${request.upcoming.map((w) => `${w.fa} (${w.gloss})`).join(", ") || "(none)"}

What they study and care about: ${request.interests.join(", ") || "everyday conversation"}

Choose ${request.count} new words.`;

  return (await askJson("expansion", Expansion, system, user)).items;
}

const PatternDrafts = z.object({ sentences: Drafts.shape.sentences });

/** Sentences that show one new piece of grammar using only words the learner knows. */
export async function draftPatternSentences(
  pattern: { form: Form; title: string; summary: string },
  known: Lexeme[],
  patterns: Set<string>,
  count: number,
): Promise<SentenceDraft[]> {
  const allowedForms = (lexeme: Lexeme): Form[] =>
    formsFor(lexeme).filter((form) => {
      const needs = FORM_PATTERN[form];
      return form === pattern.form || !needs || patterns.has(needs);
    });
  const forms = new Set(known.flatMap(allowedForms).filter((form) => form !== "base"));

  const system = `You write the first sentences that teach one new piece of grammar to an adult learning spoken Tehrani Persian. ${REGISTER}

The new grammar — ${pattern.title}: ${pattern.summary}
In the word list it is the form "${pattern.form}".

Rules:
- Every sentence uses the form "${pattern.form}" exactly once, on a word where it is natural and its meaning is obvious.
- Use ONLY the words in the list, by id. A word may only take the forms listed for it.${[...forms].map((form) => `\n  - "${form}": ${FORM_HELP[form as Exclude<Form, "base">]}`).join("")}
- 2 to 5 words, simple, natural, something a person would really say. The first sentence should be the plainest.
- kind: "statement"${patterns.has("question") ? ', "yes-no-question" (rising intonation)' : ""} or "wh-question" (only with a question word).
- comma: true when a comma follows that word.
- english: a natural translation of exactly what the Persian says.`;
  const user = `Words (id — Persian — pronunciation — meaning — forms allowed):
${known.map((w) => `${w.id} — ${w.fa} — ${w.translit} — ${w.gloss} — ${allowedForms(w).join(", ")}`).join("\n")}

Write ${count} sentences.`;

  return (await askJson("pattern", PatternDrafts, system, user)).sentences;
}
