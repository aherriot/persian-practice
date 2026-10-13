import type { SentenceToken } from "@/lib/db/schema";
import { normalizeForCompare } from "@/lib/normalize";
import type { Lexeme, Sentence } from "./types";

/**
 * The shapes a word can take inside a generated sentence. The LLM author only
 * names a form; the spelling, vowel marks and transliteration are derived here,
 * so they are always consistent and each form is tied to the grammar pattern a
 * learner must know before meeting it.
 */
export const FORMS = ["base", "negated", "is", "linked", "my", "your", "his"] as const;
export type Form = (typeof FORMS)[number];

/** The pattern each form exercises. Ids match the curated patterns. */
export const FORM_PATTERN: Record<Form, string | null> = {
  base: null,
  negated: "negation",
  is: "copula",
  linked: "ezafe",
  my: "possessive-my",
  your: "possessive-your",
  his: "possessive-his",
};

/**
 * Grammar taught after the curated themes run out, in this order, by the
 * expansion author (src/lib/lesson/expand.ts). Each entry is a pattern row
 * plus the form above that produces it. Hand-written, because a form needs a
 * spelling rule the code can apply and check; vocabulary has no such limit.
 *
 * The spoken plural (سیبا) is deliberately absent: as an object it normally
 * needs رو, and taught bare it produced sentences a reviewer called unnatural.
 *
 * Not yet reviewed by a native speaker.
 */
export const GRAMMAR_SPINE: { form: Form; id: string; title: string; summary: string }[] = [
  {
    form: "my",
    id: "possessive-my",
    title: '"My" as an ending',
    summary:
      'Instead of a separate word, "my" is usually an -am on the end of the noun: سیبم (sibam, my apple). It means the same as سیبِ من, and is what people say most.',
  },
  {
    form: "your",
    id: "possessive-your",
    title: '"Your" as an ending',
    summary: 'The informal "your" is an -et on the end of the noun: سیبت (sibet, your apple). Book Persian says -at.',
  },
  {
    form: "his",
    id: "possessive-his",
    title: '"His", "her", "its" as an ending',
    summary:
      'One ending, -esh, covers his, her and its: سیبش (sibesh, his or her apple). Persian has no he/she distinction. Book Persian says -ash.',
  },
];

export const FORM_HELP: Record<Exclude<Form, "base">, string> = {
  negated: 'verb with نـ in front: دارم → ندارم ("I don\'t have")',
  is: 'the spoken "is" ending ـه on the last word: سیب → سیبه ("is an apple")',
  linked: "ezâfe, the unwritten -e linking a noun to the word after it: نونِ تازه",
  my: '"my" as the ending -am on a noun: سیبم',
  your: 'informal "your" as the ending -et on a noun: سیبت',
  his: '"his/her/its" as the ending -esh on a noun: سیبش',
};

// The suffix rules below are only right after a consonant. After a vowel the
// endings change shape (تازه‌ست, خونه‌ی), so those are refused rather than guessed.
const endsInConsonant = (lexeme: Lexeme) => !/[aeiouâ]$/.test(lexeme.translit);

export function formsFor(lexeme: Lexeme): Form[] {
  if (lexeme.verbPerson) return ["base", "negated"];
  if (lexeme.subjectPronoun || !endsInConsonant(lexeme)) return ["base"];
  return ["base", "is", "linked", "my", "your", "his"];
}

/** The token for `lexeme` in `form`, or null if that word cannot take it. */
export function applyForm(lexeme: Lexeme, form: Form): SentenceToken | null {
  if (!formsFor(lexeme).includes(form)) return null;
  const base = { lexemeId: lexeme.id, fa: lexeme.fa, voc: lexeme.voc, translit: lexeme.translit };
  switch (form) {
    case "base":
      return base;
    case "negated": {
      // na- on a bare verb (ندارم), ne- before the mi- prefix (نمی‌خوام).
      const [mark, sound] = lexeme.fa.startsWith("می") ? ["نِ", "ne"] : ["نَ", "na"];
      return { ...base, fa: `ن${lexeme.fa}`, voc: `${mark}${lexeme.voc}`, translit: `${sound}${lexeme.translit}` };
    }
    case "is":
      return { ...base, fa: `${lexeme.fa}ه`, voc: `${lexeme.voc}ِه`, translit: `${lexeme.translit}e` };
    case "linked":
      return { ...base, voc: `${lexeme.voc}ِ`, translit: `${lexeme.translit}-e` };
    case "my":
      return { ...base, fa: `${lexeme.fa}م`, voc: `${lexeme.voc}َم`, translit: `${lexeme.translit}am` };
    case "your":
      return { ...base, fa: `${lexeme.fa}ت`, voc: `${lexeme.voc}ِت`, translit: `${lexeme.translit}et` };
    case "his":
      return { ...base, fa: `${lexeme.fa}ش`, voc: `${lexeme.voc}ِش`, translit: `${lexeme.translit}esh` };
  }
}

/**
 * What a learner is told to do to a word to put it in each form, for the forms
 * that change how it is written. (The linking -e changes only how it is said.)
 */
export const FORM_ASK: Partial<Record<Form, string>> = {
  negated: "Make it negative",
  is: "Make it say “is …”",
  my: "Make it “my …”",
  your: "Make it “your …”",
  his: "Make it “his …” or “her …”",
};

/**
 * The word in a sentence that shows a grammar pattern at work: one written in
 * the form that pattern makes, exactly as the rules here would write it. Null
 * if the sentence has none, or shows the pattern some other way (two endings
 * at once, or an ending after a vowel, which these rules do not cover).
 */
export function formToken(
  sentence: Pick<Sentence, "tokens" | "patternIds">,
  lexemes: Map<string, Lexeme>,
  patternId: string,
): { index: number; form: Form; lexeme: Lexeme } | null {
  if (!sentence.patternIds.includes(patternId)) return null;
  for (const form of FORMS) {
    if (FORM_PATTERN[form] !== patternId || !FORM_ASK[form]) continue;
    for (const [index, token] of sentence.tokens.entries()) {
      const lexeme = lexemes.get(token.lexemeId);
      const made = lexeme && applyForm(lexeme, form);
      if (made && normalizeForCompare(made.fa) === normalizeForCompare(token.fa)) return { index, form, lexeme };
    }
  }
  return null;
}
