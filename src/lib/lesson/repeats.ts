import { normalizeForCompare } from "@/lib/normalize";
import type { Assembled } from "./assemble";
import type { Candidate, Rejection } from "./drafts";
import { sentenceText } from "./plan";
import { loadNearWords } from "./store";

/** The learner's sentences closest to a candidate, shown to the reviewer beside it. */
const SHOWN_SIMILAR = 5;

type Words = Pick<Assembled, "tokens" | "patternIds">;

const plainText = (s: Pick<Assembled, "tokens">) => normalizeForCompare(s.tokens.map((t) => t.fa).join(" "));

/** The same words in the same forms and the same grammar, in whatever order: one exercise, however it is worded. */
const sameExercise = (s: Words) =>
  [...s.tokens.map((t) => normalizeForCompare(t.fa))].sort().join(" ") + " | " + [...s.patternIds].sort().join(" ");

/** How many words one sentence has that the other does not, counted both ways. */
export function wordDistance(a: string[], b: string[]): number {
  const shared = a.filter((id) => b.includes(id)).length;
  return a.length + b.length - 2 * shared;
}

/**
 * Drops candidates that repeat something the learner already has, or an
 * earlier one in the batch: the same text, or the same words and grammar in
 * another order. Each one kept that only practises is given the learner's
 * sentences closest to it (a word apart at most), so the reviewer can turn
 * down one that says the same thing in other words. One that teaches something
 * new differs by that already.
 */
export async function dropRepeats(userId: string, considered: Candidate[]): Promise<{ candidates: Candidate[]; rejected: Rejection[] }> {
  const near = await loadNearWords(userId, considered.map((c) => c.sentence.lexemeIds));
  const taken = new Set(near.flatMap((s) => [plainText(s), sameExercise(s)]));
  const candidates: Candidate[] = [];
  const rejected: Rejection[] = [];
  for (const candidate of considered) {
    const { sentence } = candidate;
    const keys = [plainText(sentence), sameExercise(sentence)];
    if (keys.some((key) => taken.has(key))) {
      rejected.push({ text: sentenceText(sentence), reason: "already exists" });
      continue;
    }
    for (const key of keys) taken.add(key);
    const similar = candidate.teaches
      ? []
      : near
          .filter((s) => wordDistance(s.lexemeIds, sentence.lexemeIds) <= 1)
          .slice(0, SHOWN_SIMILAR)
          .map((s) => `${sentenceText(s)} = ${s.english}`);
    candidates.push({ ...candidate, similar });
  }
  return { candidates, rejected };
}
