import type { SentenceToken } from "@/lib/db/schema";
import type { AcceptedAnswer } from "./variants";

export type Lexeme = {
  id: string;
  fa: string;
  voc: string;
  translit: string;
  gloss: string;
  lemma: string | null;
  literary: string | null;
  note: string | null;
  /** Set on a subject pronoun: whose pronoun it is. */
  subjectPronoun: Person | null;
  /** Set on a verb form: who its ending says is doing it. */
  verbPerson: Person | null;
  /** The learner who added it; null for curated words. */
  ownerId: string | null;
  addedBy: "learner" | "app" | null;
};

export type Person = "1sg" | "2sg" | "3sg" | "1pl" | "2pl" | "3pl";

export type Pattern = { id: string; title: string; summary: string };

export type Sentence = {
  id: string;
  position: number;
  english: string;
  note: string | null;
  tokens: SentenceToken[];
  endPunct: string;
  lexemeIds: string[];
  patternIds: string[];
  /** Written by the LLM author rather than by hand. */
  generated: boolean;
  /** May introduce its one new word or pattern. Off the ladder, a sentence only practises what is known. */
  ladder: boolean;
};

export type ThemeContent = {
  sentences: Sentence[]; // ladder order
  lexemes: Map<string, Lexeme>;
  patterns: Map<string, Pattern>;
};

export type Kind = "lexeme" | "pattern";
export type Target = { kind: Kind; id: string };
export const targetKey = (t: Target) => `${t.kind}:${t.id}`;

export type KnowledgeState = {
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  dueAt: Date;
};

// --- What the client receives. Every exercise is self-contained, so moving to
// the next one needs no request. ---

export type DisplayToken = {
  lexemeId: string;
  fa: string;
  voc: string;
  translit: string;
  gloss: string;
  /** Short-vowel marks fade once the learner knows the word. */
  showVowels: boolean;
  after?: string;
};

export type DisplaySentence = {
  id: string;
  tokens: DisplayToken[];
  endPunct: string;
  english: string;
  translit: string;
  note: string | null;
  audioUrl: string;
  generated: boolean;
};

type Graded = {
  key: string;
  sentence: DisplaySentence;
  /** Gets the lapse if the answer is wrong. Null for ungraded extra practice. */
  primary: Target | null;
  /** Everything else the sentence exercises; only advanced if already due. */
  others: Target[];
};

export type IntroLexemeExercise = {
  type: "intro-lexeme";
  key: string;
  target: Target;
  lexeme: Lexeme & { audioUrl: string };
  sentence: DisplaySentence;
};

export type IntroPatternExercise = {
  type: "intro-pattern";
  key: string;
  target: Target;
  pattern: Pattern;
  sentence: DisplaySentence;
};

export type ChoiceExercise = Graded & {
  type: "choice";
  /**
   * listen: hear the sentence, pick its meaning.  read: see it, pick its meaning.
   * word: see one word, pick its meaning.  cloze: pick the missing word.
   */
  variant: "listen" | "read" | "word" | "cloze";
  options: string[];
  answer: number;
  /** word: the token shown.  cloze: the token blanked out. */
  tokenIndex?: number;
  wordAudioUrl?: string;
};

export type TilesExercise = Graded & {
  type: "tiles";
  tiles: { fa: string; voc: string; showVowels: boolean }[];
  /** Normalised word sequences that count as correct, the model answer first. */
  accepted: AcceptedAnswer[];
};

export type Exercise = IntroLexemeExercise | IntroPatternExercise | ChoiceExercise | TilesExercise;

export type SessionPlan = {
  exercises: Exercise[];
  newCount: number;
  reviewCount: number;
};
