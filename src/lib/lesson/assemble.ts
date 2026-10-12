import { applyForm, FORM_PATTERN, type Form } from "./forms";
import type { Lexeme, Sentence } from "./types";

/** What the LLM author returns for one sentence: word ids and form names, never spellings. */
export type SentenceDraft = {
  english: string;
  kind: "statement" | "yes-no-question" | "wh-question";
  tokens: { word: string; form: Form; comma: boolean }[];
};

export type Assembled = Pick<Sentence, "english" | "tokens" | "endPunct" | "lexemeIds" | "patternIds">;

const MIN_WORDS = 2;
const MAX_WORDS = 7;

/**
 * Turns a draft into a sentence, or says why it cannot be used. This is the
 * mechanical half of checking generated content: nothing gets through that
 * uses a word or a piece of grammar the learner has not met.
 */
export function assembleSentence(
  draft: SentenceDraft,
  lexemes: Map<string, Lexeme>,
  allowed: { lexemes: Set<string>; patterns: Set<string> },
): { ok: true; sentence: Assembled } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (!draft.english.trim()) return fail("no English");
  if (draft.tokens.length < MIN_WORDS || draft.tokens.length > MAX_WORDS) return fail("wrong length");

  const patternIds = new Set<string>();
  const tokens: Sentence["tokens"] = [];
  for (const [index, spec] of draft.tokens.entries()) {
    const lexeme = lexemes.get(spec.word);
    if (!lexeme || !allowed.lexemes.has(spec.word)) return fail(`unknown word "${spec.word}"`);
    const token = applyForm(lexeme, spec.form);
    if (!token) return fail(`"${spec.word}" cannot be ${spec.form}`);
    const pattern = FORM_PATTERN[spec.form];
    if (pattern) patternIds.add(pattern);
    const last = index === draft.tokens.length - 1;
    tokens.push(spec.comma && !last ? { ...token, after: "،" } : token);
  }
  if (draft.kind === "yes-no-question") patternIds.add("question");
  for (const id of patternIds) if (!allowed.patterns.has(id)) return fail(`grammar not learned: ${id}`);

  return {
    ok: true,
    sentence: {
      english: draft.english.trim(),
      tokens,
      endPunct: draft.kind === "statement" ? "." : "؟",
      lexemeIds: [...new Set(tokens.map((t) => t.lexemeId))],
      patternIds: [...patternIds],
    },
  };
}
