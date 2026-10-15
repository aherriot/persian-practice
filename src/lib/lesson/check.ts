import { normalizeForCompare } from "@/lib/normalize";
import { formToken } from "./forms";
import { componentsOf, sentenceText } from "./plan";
import { EXERCISE_SKILL, targetKey, type ExerciseName, type Sentence, type Target, type ThemeContent } from "./types";
import { acceptedAnswers, spokenWords } from "./variants";

export const EXERCISES = Object.keys(EXERCISE_SKILL) as [ExerciseName, ...ExerciseName[]];

/** What a learner did in one exercise, as the browser reports it. */
export type Submission = {
  sentenceId: string;
  exercise: ExerciseName;
  /** What the exercise was testing; null for ungraded extra practice. */
  primary: Target | null;
  /** The option picked, or for sentence-building the words in the order they were placed. */
  answer: string | string[];
  /** Answered to show the learner knew `primary` already, when it was about to be taught (see Claim in types.ts). */
  claim?: boolean;
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
 * `content` holds the sentence's words; for sentence-building the other
 * sentences that say the same thing along with theirs and the subject
 * pronouns; and for a reply the sentences that answer this one.
 */
export function checkAnswer(sentence: Sentence, content: ThemeContent, submission: Submission): Verdict {
  const { exercise, primary, answer } = submission;
  const components = componentsOf(sentence);
  if (primary && !components.some((c) => targetKey(c) === targetKey(primary))) {
    return { ok: false, reason: "the sentence does not use that word or grammar point" };
  }

  let correct: boolean;
  if (exercise === "tiles" || exercise === "dictation") {
    if (!Array.isArray(answer)) return { ok: false, reason: "a built sentence is a list of words" };
    const built = normalizeForCompare(answer.join(" "));
    correct =
      exercise === "tiles"
        ? acceptedAnswers(sentence, content).some((accepted) => accepted.text === built)
        : // What was said, not another way of saying it.
          built === spokenWords(sentence);
  } else if (Array.isArray(answer)) {
    return { ok: false, reason: "a choice is one option" };
  } else if (exercise === "listen" || exercise === "read") {
    correct = answer === sentence.english;
  } else if (exercise === "reply-heard" || exercise === "reply-read") {
    const said = normalizeForCompare(answer);
    correct = content.sentences.some((other) => other.replyTo?.includes(sentence.id) && normalizeForCompare(sentenceText(other)) === said);
  } else if (exercise === "transform") {
    if (primary?.kind !== "pattern") return { ok: false, reason: "a form exercise is about a grammar point" };
    const found = formToken(sentence, content.lexemes, primary.id);
    if (!found) return { ok: false, reason: "the sentence does not show that grammar point in a word" };
    correct = normalizeForCompare(answer) === normalizeForCompare(sentence.tokens[found.index].fa);
  } else {
    if (primary?.kind !== "lexeme") return { ok: false, reason: "a word exercise is about a word" };
    const lexeme = content.lexemes.get(primary.id);
    const token = sentence.tokens.find((t) => t.lexemeId === primary.id);
    if (!lexeme || !token) return { ok: false, reason: "unknown word" };
    const same = (persian: string) => normalizeForCompare(answer) === normalizeForCompare(persian);
    if (exercise === "hear-word" || exercise === "read-word") correct = answer === lexeme.gloss;
    else if (exercise === "pick-word" || exercise === "hear-pick") correct = same(lexeme.fa);
    else if (exercise === "pronounce") correct = answer === token.translit;
    else correct = same(token.fa);
  }

  return {
    ok: true,
    correct,
    primary,
    others: components.filter((c) => !primary || targetKey(c) !== targetKey(primary)),
    picked: correct ? null : Array.isArray(answer) ? answer.join(" ") : answer,
  };
}
