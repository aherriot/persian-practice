import { audioUrl, clipSpec, wordClip, type ClipSpec } from "@/lib/audio-key";
import { acceptedAnswers } from "./variants";
import {
  SKILLS,
  targetKey,
  type ChoiceExercise,
  type DisplaySentence,
  type Exercise,
  type KnowledgeState,
  type Sentence,
  type SessionPlan,
  type Skill,
  type SkillState,
  type Target,
  type ThemeContent,
  type TilesExercise,
} from "./types";

/** Short-vowel marks stay on a word until it has been read right this many times running. */
export const VOWEL_FADE_REPS = 3;

export type PlanOptions = {
  now: Date;
  seed: number;
  maxNew?: number;
  maxReview?: number;
  /**
   * Target keys to review in place of whatever is due, in this order: a
   * session about chosen things (the weak-words session) rather than the
   * schedule's. Ones the learner has not met are ignored.
   */
  review?: string[];
  minExercises?: number;
  /** How many times the learner has answered each sentence. Reviews prefer the least seen. */
  seen?: Map<string, number>;
  /** Meanings to offer as wrong answers. Defaults to the content's own sentences. */
  distractors?: Distractor[];
  /**
   * For a word, the words this learner has mixed it up with (see confusions.ts).
   * Offered first as wrong answers when that word is asked about.
   */
  confusions?: Map<string, string[]>;
  /** Sentences outside the content that may say the same thing as one inside it, in other words. */
  alternates?: Sentence[];
};

export type Distractor = { english: string; length: number };

export const DEFAULT_MAX_NEW = 3;
export const DEFAULT_MAX_REVIEW = 8;

/** One skill of one word or grammar point, up for review. */
export type Due = { key: string; skill: Skill; state: SkillState };

/** Where equally due skills of one thing start from: spread by the thing, so a session is not all of one skill. */
const firstSkill = (key: string) => [...key].reduce((sum, char) => sum + char.charCodeAt(0), 0) % SKILLS.length;

/**
 * What a session reviews: the skills that are due, most overdue first, or the
 * weakest skill of each thing it was asked for. Each thing comes up in one
 * skill before any comes up in a second.
 */
export function dueTargets(knowledge: Map<string, KnowledgeState>, now: Date, max: number, review?: string[]): Due[] {
  const skillsOf = (key: string, state: KnowledgeState): Due[] => {
    const from = firstSkill(key);
    return SKILLS.map((_, i) => SKILLS[(from + i) % SKILLS.length]).map((skill) => ({ key, skill, state: state.skills[skill] }));
  };
  if (review) {
    return review
      .flatMap((key) => {
        const state = knowledge.get(key);
        if (!state) return [];
        const weakest = (a: Due, b: Due) => a.state.repetitions - b.state.repetitions || a.state.dueAt.getTime() - b.state.dueAt.getTime();
        return skillsOf(key, state).sort(weakest).slice(0, 1);
      })
      .slice(0, max);
  }
  const due = [...knowledge.entries()]
    .flatMap(([key, state]) => skillsOf(key, state))
    .filter(({ state }) => state.dueAt <= now)
    .sort((a, b) => a.state.dueAt.getTime() - b.state.dueAt.getTime());
  const first = due.filter((item, i) => due.findIndex((other) => other.key === item.key) === i);
  const again = due.filter((item) => !first.includes(item));
  return [...first, ...again].slice(0, max);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sentenceText(s: Pick<Sentence, "tokens" | "endPunct">): string {
  return s.tokens.map((t) => t.fa + (t.after ?? "")).join(" ") + s.endPunct;
}

export function sentenceClip(s: Pick<Sentence, "tokens" | "endPunct">): ClipSpec {
  return clipSpec(sentenceText(s), s.tokens.map((t) => t.translit).join(" "));
}

export function componentsOf(s: Sentence): Target[] {
  return [
    ...s.lexemeIds.map((id): Target => ({ kind: "lexeme", id })),
    ...s.patternIds.map((id): Target => ({ kind: "pattern", id })),
  ];
}

/**
 * Plans a whole session up front so the client never waits between exercises.
 *
 * New material comes off the theme's ladder in order, at most `maxNew` things
 * per session. Reviews are whatever is due, each practised inside a sentence
 * made only of things the learner already knows.
 */
export function planSession(
  content: ThemeContent,
  knowledge: Map<string, KnowledgeState>,
  opts: PlanOptions,
): SessionPlan {
  const { now, maxNew = DEFAULT_MAX_NEW, maxReview = DEFAULT_MAX_REVIEW, minExercises = 6 } = opts;
  const distractors: Distractor[] =
    opts.distractors ?? content.sentences.map((s) => ({ english: s.english, length: s.tokens.length }));
  const withAlternates = opts.alternates ? { ...content, sentences: [...content.sentences, ...opts.alternates] } : content;
  const rand = mulberry32(opts.seed);
  const shuffle = <T>(items: T[]): T[] => {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const known = new Set(knowledge.keys());
  const usedSentences = new Set<string>();
  // Shuffled, then the sentences answered least often first: a word is tested
  // in a sentence the learner cannot simply remember.
  const seenCount = (s: Sentence) => opts.seen?.get(s.id) ?? 0;
  const leastSeen = (items: Sentence[]) => shuffle(items).sort((a, b) => seenCount(a) - seenCount(b));
  let counter = 0;
  const nextKey = (label: string) => `${label}-${counter++}`;

  // Vowel marks are a reading aid, so it is reading that fades them.
  const showVowels = (lexemeId: string) => (knowledge.get(`lexeme:${lexemeId}`)?.skills.reading.repetitions ?? 0) < VOWEL_FADE_REPS;

  const display = (s: Sentence): DisplaySentence => ({
    id: s.id,
    tokens: s.tokens.map((t) => ({
      ...t,
      gloss: content.lexemes.get(t.lexemeId)?.gloss ?? "",
      showVowels: showVowels(t.lexemeId),
    })),
    endPunct: s.endPunct,
    english: s.english,
    translit: s.tokens.map((t) => t.translit + (t.after ? "," : "")).join(" "),
    note: s.note,
    audioUrl: audioUrl(sentenceClip(s)),
    generated: s.generated,
  });

  const graded = (s: Sentence, primary: Target | null) => {
    usedSentences.add(s.id);
    return {
      sentence: display(s),
      primary,
      others: componentsOf(s).filter((c) => !primary || targetKey(c) !== targetKey(primary)),
    };
  };

  const withOptions = (correct: string, distractors: string[]) => {
    const options = shuffle([correct, ...distractors.slice(0, 3)]);
    return { options, answer: options.indexOf(correct) };
  };

  /**
   * The words the learner has mixed this one up with, where the session has
   * them. Two at most, so one of the wrong answers still changes each time.
   */
  const confusedWith = (lexemeId: string) =>
    (opts.confusions?.get(lexemeId) ?? []).flatMap((id) => content.lexemes.get(id) ?? []).slice(0, 2);

  const meaningChoice = (s: Sentence, primary: Target | null, variant: "listen" | "read"): ChoiceExercise => {
    const seen = new Set([s.english]);
    const others = shuffle(distractors)
      .filter((o) => !seen.has(o.english) && seen.add(o.english))
      // Near-length sentences make more plausible wrong answers.
      .sort((a, b) => Math.abs(a.length - s.tokens.length) - Math.abs(b.length - s.tokens.length))
      .map((o) => o.english);
    return { type: "choice", variant, key: nextKey(variant), ...graded(s, primary), ...withOptions(s.english, others) };
  };

  const wordChoice = (s: Sentence, lexemeId: string, variant: "hear-word" | "read-word"): ChoiceExercise => {
    const lexeme = content.lexemes.get(lexemeId)!;
    const mixedUp = confusedWith(lexemeId).map((l) => l.gloss);
    const glosses = [...mixedUp, ...shuffle([...content.lexemes.values()]).map((l) => l.gloss)].filter((gloss) => gloss !== lexeme.gloss);
    return {
      type: "choice",
      variant,
      key: nextKey(variant),
      ...graded(s, { kind: "lexeme", id: lexemeId }),
      ...withOptions(lexeme.gloss, [...new Set(glosses)]),
      tokenIndex: s.tokens.findIndex((t) => t.lexemeId === lexemeId),
      wordAudioUrl: audioUrl(wordClip(lexeme)),
    };
  };

  /** The meaning is shown; the learner picks the Persian word for it. */
  const pickWord = (s: Sentence, lexemeId: string): ChoiceExercise => {
    const lexeme = content.lexemes.get(lexemeId)!;
    // Another word for the same thing would be a second right answer.
    const pool = shuffle([...content.lexemes.values()]).filter((l) => l.fa !== lexeme.fa && l.gloss !== lexeme.gloss);
    const mixedUp = new Set(confusedWith(lexemeId).map((l) => l.id));
    const rank = (l: (typeof pool)[number]) => (mixedUp.has(l.id) ? 0 : known.has(`lexeme:${l.id}`) ? 1 : 2);
    const distractors = pool.sort((a, b) => rank(a) - rank(b)).map((l) => l.fa);
    return {
      type: "choice",
      variant: "pick-word",
      key: nextKey("pick-word"),
      ...graded(s, { kind: "lexeme", id: lexemeId }),
      ...withOptions(lexeme.fa, [...new Set(distractors)]),
      tokenIndex: s.tokens.findIndex((t) => t.lexemeId === lexemeId),
      wordAudioUrl: audioUrl(wordClip(lexeme)),
    };
  };

  const cloze = (s: Sentence, lexemeId: string): ChoiceExercise => {
    const tokenIndex = s.tokens.findIndex((t) => t.lexemeId === lexemeId);
    const correct = s.tokens[tokenIndex].fa;
    const lexeme = content.lexemes.get(lexemeId)!;
    const pool = shuffle([...content.lexemes.values()]).filter((l) => l.fa !== correct && l.id !== lexemeId);
    // Words mixed up with this one before, other forms of the same verb, then words the learner has met.
    const mixedUp = new Set(confusedWith(lexemeId).map((l) => l.id));
    const rank = (l: (typeof pool)[number]) =>
      mixedUp.has(l.id) ? -1 : lexeme.lemma && l.lemma === lexeme.lemma ? 0 : known.has(`lexeme:${l.id}`) ? 1 : 2;
    const distractors = pool.sort((a, b) => rank(a) - rank(b)).map((l) => l.fa);
    return {
      type: "choice",
      variant: "cloze",
      key: nextKey("cloze"),
      ...graded(s, { kind: "lexeme", id: lexemeId }),
      ...withOptions(correct, [...new Set(distractors)]),
      tokenIndex,
    };
  };

  const tiles = (s: Sentence, primary: Target | null): TilesExercise => {
    const d = display(s);
    const inSentence = new Set(s.tokens.map((t) => t.fa));
    const extras = shuffle([...content.lexemes.values()])
      .filter((l) => known.has(`lexeme:${l.id}`) && !inSentence.has(l.fa))
      .slice(0, 2)
      .map((l) => ({ fa: l.fa, voc: l.voc, showVowels: showVowels(l.id) }));
    return {
      type: "tiles",
      variant: "tiles",
      key: nextKey("tiles"),
      ...graded(s, primary),
      tiles: shuffle([...d.tokens.map((t) => ({ fa: t.fa, voc: t.voc, showVowels: t.showVowels })), ...extras]),
      accepted: acceptedAnswers(s, withAlternates),
    };
  };

  const isEligible = (s: Sentence) => componentsOf(s).every((c) => known.has(targetKey(c)));

  // --- Reviews: decided before anything new is marked known, so a review
  // never leans on a word introduced later in the same session. ---
  const due = dueTargets(knowledge, now, maxReview, opts.review);

  const reviews: Exercise[] = [];
  for (const { key, skill, state } of due) {
    const kind = key.slice(0, key.indexOf(":")) as Target["kind"];
    const id = key.slice(key.indexOf(":") + 1);
    const target: Target = { kind, id };
    const containing = content.sentences.filter(
      (s) => isEligible(s) && (kind === "lexeme" ? s.lexemeIds : s.patternIds).includes(id),
    );
    if (containing.length === 0) continue; // belongs to another theme
    const fresh = containing.filter((s) => !usedSentences.has(s.id));
    const candidates = fresh.length > 0 ? fresh : containing;
    // There is nothing to build in a sentence of one word.
    const longer = candidates.filter((s) => s.tokens.length >= 2);
    const s = leastSeen(skill === "producing" && longer.length > 0 ? longer : candidates)[0];
    const multiWord = s.tokens.length >= 2;
    const word = kind === "lexeme";
    const reps = state.repetitions;

    // A word is met alone first and then in a sentence, and each skill has its own way of asking.
    if (skill === "listening") reviews.push(word && reps <= 1 && rand() < 0.5 ? wordChoice(s, id, "hear-word") : meaningChoice(s, target, "listen"));
    else if (skill === "reading") reviews.push(word && reps <= 1 && rand() < 0.5 ? wordChoice(s, id, "read-word") : meaningChoice(s, target, "read"));
    else if (word && (reps <= 1 || !multiWord)) reviews.push(pickWord(s, id));
    else if (word && reps === 2) reviews.push(cloze(s, id));
    else reviews.push(tiles(s, target));
  }

  // --- New material, in ladder order. ---
  const blocks: Exercise[][] = [];
  const deferred: Exercise[] = [];
  let newCount = 0;
  for (const s of content.sentences) {
    if (!s.ladder) continue;
    const unknown = componentsOf(s).filter((c) => !known.has(targetKey(c)));
    if (unknown.length === 0) continue;
    if (newCount + unknown.length > maxNew) break;
    for (const target of unknown) {
      known.add(targetKey(target));
      newCount++;
      if (target.kind === "lexeme") {
        const lexeme = content.lexemes.get(target.id)!;
        blocks.push([
          {
            type: "intro-lexeme",
            key: nextKey("intro"),
            target,
            lexeme: { ...lexeme, audioUrl: audioUrl(wordClip(lexeme)) },
            sentence: display(s),
          },
          wordChoice(s, target.id, "read-word"),
          meaningChoice(s, target, "listen"),
        ]);
        deferred.push(s.tokens.length >= 2 ? tiles(s, target) : pickWord(s, target.id));
      } else {
        blocks.push([
          {
            type: "intro-pattern",
            key: nextKey("intro"),
            target,
            pattern: content.patterns.get(target.id)!,
            sentence: display(s),
          },
          meaningChoice(s, target, "read"),
        ]);
        deferred.push(meaningChoice(s, target, "listen"), tiles(s, target));
      }
    }
  }

  // --- Interleave: a couple of reviews before each new thing, then the
  // harder sentence-building for the new things once they have settled. By
  // the end each new thing has been asked for in all three skills. ---
  const exercises: Exercise[] = [];
  let r = 0;
  for (const block of blocks) {
    exercises.push(...reviews.slice(r, r + 2), ...block);
    r += 2;
  }
  exercises.push(...reviews.slice(r), ...deferred);

  // --- Nothing due and nothing new: ungraded practice so a session is never empty. ---
  if (exercises.length < minExercises) {
    const spare = leastSeen(content.sentences.filter((s) => isEligible(s) && !usedSentences.has(s.id)));
    for (const s of spare) {
      if (exercises.length >= minExercises) break;
      const roll = rand();
      exercises.push(s.tokens.length >= 2 && roll < 0.4 ? tiles(s, null) : meaningChoice(s, null, roll < 0.7 ? "listen" : "read"));
    }
  }

  return { exercises, newCount, reviewCount: reviews.length };
}
