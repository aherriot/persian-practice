import type { Assembled } from "./assemble";
import { reviewSentences } from "./author";
import { sentenceText } from "./plan";
import type { Lexeme } from "./types";

/**
 * A sentence the author has written and the assembler has built, on its way
 * to being stored. Plain data, so it can wait in a job between steps.
 */
export type Candidate = {
  sentence: Assembled;
  /** What the sentence introduces, in words; null for one that only practises. */
  teaches: string | null;
  /** The new word it introduces, which is stored with it. */
  word: Lexeme | null;
  /** The learner's sentences closest to it, for the reviewer to judge whether it only repeats one (repeats.ts). */
  similar?: string[];
};

export type Rejection = { text: string; reason: string };

/** What an author's draft came to: candidates worth a second opinion, or why there are none. */
export type Draft = { skipped?: string; candidates: Candidate[]; rejected: Rejection[] };

/** The second opinion: which candidates a fresh reviewer would keep. */
export async function reviewCandidates(candidates: Candidate[]): Promise<{ kept: Candidate[]; rejected: Rejection[] }> {
  const verdicts = await reviewSentences(
    candidates.map(({ sentence, word, similar }) => ({
      persian: sentenceText(sentence),
      translit: sentence.tokens.map((t) => t.translit).join(" "),
      english: sentence.english,
      newWord: word ? `${word.fa} (${word.translit}) = ${word.gloss}` : undefined,
      similar,
    })),
  );
  const kept: Candidate[] = [];
  const rejected: Rejection[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (verdicts[index].keep) kept.push(candidate);
    else rejected.push({ text: sentenceText(candidate.sentence), reason: `reviewer: ${verdicts[index].problem}` });
  }
  return { kept, rejected };
}
