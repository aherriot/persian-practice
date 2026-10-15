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
  /** The sentences this one is a natural reply to, by id. */
  replyTo?: string[];
};

export type ThemeContent = {
  sentences: Sentence[]; // ladder order
  lexemes: Map<string, Lexeme>;
  patterns: Map<string, Pattern>;
};

export type Kind = "lexeme" | "pattern";
export type Target = { kind: Kind; id: string };
export const targetKey = (t: Target) => `${t.kind}:${t.id}`;

/**
 * Knowing a word by ear, knowing it on the page and being able to come up with
 * it are three different things, and being good at one says little about the
 * others. Each is scheduled on its own.
 *
 *   listening  the prompt is sound alone
 *   reading    the prompt is Persian text alone
 *   producing  the prompt is a meaning, and the answer is Persian
 */
export const SKILLS = ["listening", "reading", "producing"] as const;
export type Skill = (typeof SKILLS)[number];

/** One word or grammar point in one skill for one learner: its FSRS memory state (see src/lib/srs.ts) and when it is next due. */
export type SkillState = {
  stability: number;
  difficulty: number;
  intervalDays: number;
  /** Right answers in a row. */
  repetitions: number;
  /** Wrong answers ever. */
  lapses: number;
  dueAt: Date;
  lastReviewedAt: Date | null;
};

/**
 * One word or grammar point for one learner. The fields of its own are the
 * weakest of its skills — the earliest due, the fewest right in a row, the
 * hardest — so that "known" means known every way.
 */
export type KnowledgeState = SkillState & { skills: Record<Skill, SkillState> };

/** A word or grammar point from the state of each of its skills. A skill not given is taken to be like the first that is. */
export function knowledgeOf(skills: Partial<Record<Skill, SkillState>>): KnowledgeState {
  const given = SKILLS.flatMap((skill) => skills[skill] ?? []);
  if (given.length === 0) throw new Error("knowledge of something needs at least one skill");
  const all = Object.fromEntries(SKILLS.map((skill) => [skill, skills[skill] ?? given[0]])) as Record<Skill, SkillState>;
  const states = SKILLS.map((skill) => all[skill]);
  const reviewed = states.flatMap((state) => state.lastReviewedAt ?? []);
  return {
    stability: Math.min(...states.map((state) => state.stability)),
    difficulty: Math.max(...states.map((state) => state.difficulty)),
    intervalDays: Math.min(...states.map((state) => state.intervalDays)),
    repetitions: Math.min(...states.map((state) => state.repetitions)),
    lapses: Math.max(...states.map((state) => state.lapses)),
    dueAt: new Date(Math.min(...states.map((state) => state.dueAt.getTime()))),
    lastReviewedAt: reviewed.length > 0 ? new Date(Math.max(...reviewed.map((at) => at.getTime()))) : null,
    skills: all,
  };
}

/** The same state in every skill. */
export const evenly = (state: SkillState): KnowledgeState => knowledgeOf({ listening: state });

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

/** What a graded exercise is about, and how well each skill of it was known when the session was planned (see mastery.ts). */
export type ExerciseSubject = { fa: string | null; label: string; skills: Record<Skill, SkillState> };

type Graded = {
  key: string;
  sentence: DisplaySentence;
  /** Gets the lapse if the answer is wrong. Null for ungraded extra practice. */
  primary: Target | null;
  /** Everything else the sentence exercises; only advanced if already due. */
  others: Target[];
  /** Present with `primary`. */
  subject?: ExerciseSubject;
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

/**
 * Every kind of graded exercise, and the one skill each tests. The name is
 * what the browser reports and what the answer log records.
 */
export const EXERCISE_SKILL = {
  // Sound alone.
  listen: "listening", // hear a sentence, pick its meaning
  "hear-word": "listening", // hear a word, pick its meaning
  "hear-pick": "listening", // hear a word, pick which written word it was
  dictation: "listening", // hear a sentence, build it from its words
  "reply-heard": "listening", // hear something said, pick what to say back
  // Persian text alone; no sound until answered.
  read: "reading", // read a sentence, pick its meaning
  "read-word": "reading", // read a word, pick its meaning
  pronounce: "reading", // read a word without its vowel marks, pick how it is said
  "reply-read": "reading", // read something said, pick what to say back
  // A meaning, to be answered in Persian.
  "pick-word": "producing", // see a meaning, pick the Persian word
  cloze: "producing", // pick the word missing from a sentence
  transform: "producing", // put a word into the form a grammar point calls for
  tiles: "producing", // build a sentence from its words
} as const satisfies Record<string, Skill>;
export type ExerciseName = keyof typeof EXERCISE_SKILL;

export type ChoiceExercise = Graded & {
  type: "choice";
  variant: Exclude<ExerciseName, TilesExercise["variant"]>;
  options: string[];
  answer: number;
  /** For an exercise about one word: where that word is in the sentence. */
  tokenIndex?: number;
  wordAudioUrl?: string;
  /** transform: the word as it is before the change, and what the learner is told to do to it. */
  base?: { fa: string; voc: string; showVowels: boolean };
  instruction?: string;
  /** reply: the right answer in full, shown once the learner has chosen. */
  reply?: DisplaySentence;
};

export type TilesExercise = Graded & {
  type: "tiles";
  /** tiles: the meaning is shown.  dictation: the sentence is only heard. */
  variant: "tiles" | "dictation";
  tiles: { fa: string; voc: string; showVowels: boolean }[];
  /** Normalised word sequences that count as correct, the model answer first. */
  accepted: AcceptedAnswer[];
};

/** The name a graded exercise is reported and logged under. */
export const exerciseName = (exercise: ChoiceExercise | TilesExercise): ExerciseName => exercise.variant;

export type Exercise = IntroLexemeExercise | IntroPatternExercise | ChoiceExercise | TilesExercise;

export type SessionPlan = {
  exercises: Exercise[];
  newCount: number;
  reviewCount: number;
  /** There was something new to teach, and it was left for later because of how much there is to review. */
  newHeldBack: boolean;
};
