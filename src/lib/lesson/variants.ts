import { normalizeForCompare } from "@/lib/normalize";
import type { Lexeme, Sentence, ThemeContent } from "./types";

/** A word order that counts as correct, with a remark when it differs from the model answer in a way worth pointing out. */
export type AcceptedAnswer = { text: string; remark?: string };

type Words = string[];

const leadingInterjections = (s: Sentence) => {
  let n = 0;
  while (n < s.tokens.length - 1 && s.tokens[n].after === "،") n++;
  return n;
};

/**
 * Persian drops subject pronouns: the verb ending already says who. So a
 * sentence is equally right with or without the pronoun that agrees with its
 * verb. Returns the model answer's words plus those variants.
 */
function pronounVariants(s: Sentence, lexemes: Map<string, Lexeme>): { words: Words; remark?: string }[] {
  const words = s.tokens.map((t) => t.fa);
  const variants: { words: Words; remark?: string }[] = [{ words }];

  const verb = s.tokens.map((t) => ({ token: t, lexeme: lexemes.get(t.lexemeId) })).find((x) => x.lexeme?.verbPerson);
  const person = verb?.lexeme?.verbPerson;
  if (!verb || !person) return variants;
  const says = `the ending of ${verb.token.fa} already says who`;

  const present = s.tokens.findIndex((t) => lexemes.get(t.lexemeId)?.subjectPronoun === person);
  if (present >= 0) {
    variants.push({
      words: words.filter((_, i) => i !== present),
      remark: `Leaving out ${words[present]} is fine: ${says}.`,
    });
    return variants;
  }

  // Only "I", "we" and "you" can be added blindly; a third-person verb may
  // already have a noun as its subject.
  if (!person.startsWith("1") && !person.startsWith("2")) return variants;
  const at = leadingInterjections(s);
  for (const pronoun of lexemes.values()) {
    if (pronoun.subjectPronoun !== person) continue;
    variants.push({
      words: [...words.slice(0, at), pronoun.fa, ...words.slice(at)],
      remark: `${pronoun.fa} is optional here: ${says}. In everyday speech it is usually left out.`,
    });
  }
  return variants;
}

/** A sentence's words exactly as spoken, for comparing with what a learner built from hearing it. */
export const spokenWords = (sentence: Pick<Sentence, "tokens">) => normalizeForCompare(sentence.tokens.map((t) => t.fa).join(" "));

/** Every word sequence that correctly answers "build this sentence" for `s`. The model answer comes first. */
export function acceptedAnswers(s: Sentence, content: ThemeContent): AcceptedAnswer[] {
  const sameMeaning = [s, ...content.sentences.filter((o) => o !== s && o.english === s.english)];
  const accepted = new Map<string, AcceptedAnswer>();
  for (const sentence of sameMeaning) {
    for (const variant of pronounVariants(sentence, content.lexemes)) {
      const text = normalizeForCompare(variant.words.join(" "));
      // An exact match with a sentence in the content needs no remark.
      if (!accepted.has(text)) accepted.set(text, { text, ...(variant.remark ? { remark: variant.remark } : {}) });
      else if (!variant.remark) accepted.set(text, { text });
    }
  }
  return [...accepted.values()];
}
