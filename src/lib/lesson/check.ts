import { normalizeForCompare } from "@/lib/normalize";
import { componentsOf } from "./plan";
import { targetKey, type ChoiceExercise, type Sentence, type Target, type ThemeContent } from "./types";
import { acceptedAnswers } from "./variants";

export const EXERCISES = ["listen", "read", "word", "cloze", "tiles"] as const satisfies readonly (ChoiceExercise["variant"] | "tiles")[];

/** What a learner did in one exercise, as the browser reports it. */
export type Submission = {
  sentenceId: string;
  exercise: (typeof EXERCISES)[number];
  /** What the exercise was testing; null for ungraded extra practice. */
  primary: Target | null;
  /** The option picked, or for sentence-building the words in the order they were placed. */
  answer: string | string[];
};

export type Verdict =
  | { ok: false; reason: string }
  | {
      ok: true;
      correct: boolean;
      primary: Target | null;
      /** Everything else the sentence exercises. */
      others: Target[];
      /** The wrong answer given; null when the answer was right. */
      picked: string | null;
    };

/**
 * Marks a submission against the sentence it is about. The browser marks its
 * own copy for instant feedback, but what is stored is decided here, from the
 * course rather than from what the browser says happened.
 *
 * `content` holds the sentence's words, and for sentence-building the other
 * sentences that say the same thing along with theirs and the subject pronouns.
 */
export function checkAnswer(sentence: Sentence, content: ThemeContent, submission: Submission): Verdict {
  const { exercise, primary, answer } = submission;
  const components = componentsOf(sentence);
  if (primary && !components.some((c) => targetKey(c) === targetKey(primary))) {
    return { ok: false, reason: "the sentence does not use that word or grammar point" };
  }

  let correct: boolean;
  if (exercise === "tiles") {
    if (!Array.isArray(answer)) return { ok: false, reason: "a built sentence is a list of words" };
    const built = normalizeForCompare(answer.join(" "));
    correct = acceptedAnswers(sentence, content).some((accepted) => accepted.text === built);
  } else if (Array.isArray(answer)) {
    return { ok: false, reason: "a choice is one option" };
  } else if (exercise === "listen" || exercise === "read") {
    correct = answer === sentence.english;
  } else {
    if (primary?.kind !== "lexeme") return { ok: false, reason: "a word exercise is about a word" };
    const lexeme = content.lexemes.get(primary.id);
    const token = sentence.tokens.find((t) => t.lexemeId === primary.id);
    if (!lexeme || !token) return { ok: false, reason: "unknown word" };
    correct = exercise === "word" ? answer === lexeme.gloss : normalizeForCompare(answer) === normalizeForCompare(token.fa);
  }

  return {
    ok: true,
    correct,
    primary,
    others: components.filter((c) => !primary || targetKey(c) !== targetKey(primary)),
    picked: correct ? null : Array.isArray(answer) ? answer.join(" ") : answer,
  };
}
