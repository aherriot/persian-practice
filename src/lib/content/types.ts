import type { Person } from "@/lib/lesson/types";

/** Authoring format for hand-curated themes. `build.ts` resolves it into rows. */

export type LexemeSeed = {
  id: string;
  fa: string;
  voc: string;
  translit: string;
  gloss: string;
  lemma?: string;
  literary?: string;
  note?: string;
  /** Subject pronouns and verb forms say whose they are, so answers with or without the pronoun both count. */
  subjectPronoun?: Person;
  verbPerson?: Person;
};

export type PatternSeed = { id: string; title: string; summary: string };

/** A lexeme id, or an override when the word appears in a different shape. */
export type TokenSeed =
  | string
  | { lex: string; fa?: string; voc?: string; translit?: string; after?: string };

export type SentenceSeed = {
  english: string;
  tokens: TokenSeed[];
  end?: "." | "؟" | "!";
  patterns?: string[];
  note?: string;
  /**
   * The English of sentences in this theme that this one is a natural reply
   * to: "How are you?" on "I'm well, thanks.". Give every sentence that would
   * do as a reply — one left out may be offered as a wrong answer.
   */
  answers?: string[];
};

export type ThemeSeed = {
  id: string;
  title: string;
  titleFa: string;
  description: string;
  position: number;
  lexemes: LexemeSeed[];
  patterns: PatternSeed[];
  /** The ladder: each sentence may add at most one new lexeme or pattern. */
  sentences: SentenceSeed[];
};
