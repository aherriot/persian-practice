import { audioUrl, clipSpec, wordClip, type ClipSpec } from "@/lib/audio-key";
import { applyForm, FORM_ASK, formsFor, formToken } from "./forms";
import { introducedState } from "./grade";
import { aheadBy, newPerSession } from "./pace";
import { otherReadings, soundDistance } from "./sounds";
import { acceptedAnswers, spokenWords } from "./variants";
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
  type ExerciseSubject,
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
   * Target keys of what the learner keeps getting wrong, weakest first (see
   * weak.ts). Reviewed before anything else that is due, and brought up even
   * when not due while the session has room. Ones not met are ignored.
   */
  weak?: string[];
  /**
   * Target keys of what the learner was asked about lately (see session.ts).
   * Not brought up again early, weak or not: a right answer to something not
   * yet due leaves its schedule as it is, so without this a weak word would
   * come back in every session until it fell due.
   */
  recent?: Set<string>;
  /** How hard to push the learner, 0 to 1 (pace.ts). Sets the default `maxNew`, and how soon exercises get harder. */
  stretch?: number;
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
  /**
   * Words that cannot be said alone, whose own clip is a sentence they are in
   * (و is "o" only between other words; see audio-store.ts). Never asked about
   * by the sound of the word alone.
   */
  unspeakable?: Set<string>;
};

export type Distractor = { english: string; length: number };

export const DEFAULT_MAX_NEW = 3;
export const DEFAULT_MAX_REVIEW = 8;

/**
 * How many new things a session may teach when it already has `reviews` to
 * do. Review comes first: new material gets only the share of the session
 * that review leaves free, and none once review fills it.
 */
export const roomForNew = (reviews: number, maxNew: number, maxReview: number) =>
  maxReview <= 0 ? maxNew : Math.max(0, Math.ceil(maxNew * (1 - reviews / maxReview)));

/** One skill of one word or grammar point, up for review. `early`: weak, and brought up before it is due. */
export type Due = { key: string; skill: Skill; state: SkillState; early?: boolean };

/** Where equally due skills of one thing start from: spread by the thing, so a session is not all of one skill. */
const firstSkill = (key: string) => [...key].reduce((sum, char) => sum + char.charCodeAt(0), 0) % SKILLS.length;

/**
 * What a session reviews. Each thing comes up in one skill before any comes
 * up in a second, in this order:
 *   1. weak things that are due, the weakest first;
 *   2. everything else that is due, the most overdue first;
 *   3. weak things that are not due yet, each in its weakest skill, unless
 *      asked about lately (`recent`);
 *   4. second and later skills of what is due.
 * A weak thing reviewed early is graded by the usual rules: a right answer
 * moves it on only if it was due, so practising it does not push it out of sight.
 */
export function dueTargets(
  knowledge: Map<string, KnowledgeState>,
  now: Date,
  max: number,
  weak: string[] = [],
  recent: Set<string> = new Set(),
): Due[] {
  const skillsOf = (key: string, state: KnowledgeState): Due[] => {
    const from = firstSkill(key);
    return SKILLS.map((_, i) => SKILLS[(from + i) % SKILLS.length]).map((skill) => ({ key, skill, state: state.skills[skill] }));
  };
  const rank = new Map(weak.map((key, i) => [key, i]));
  const weakFirst = (a: Due, b: Due) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity) || 0;
  const due = [...knowledge.entries()]
    .flatMap(([key, state]) => skillsOf(key, state))
    .filter(({ state }) => state.dueAt <= now)
    .sort((a, b) => weakFirst(a, b) || a.state.dueAt.getTime() - b.state.dueAt.getTime());
  const first = due.filter((item, i) => due.findIndex((other) => other.key === item.key) === i);
  const again = due.filter((item) => !first.includes(item));
  const weakest = (a: Due, b: Due) => a.state.repetitions - b.state.repetitions || a.state.dueAt.getTime() - b.state.dueAt.getTime();
  const early = weak.flatMap((key) => {
    const state = knowledge.get(key);
    if (!state || recent.has(key) || first.some((item) => item.key === key)) return [];
    return skillsOf(key, state)
      .sort(weakest)
      .slice(0, 1)
      .map((item) => ({ ...item, early: true }));
  });
  return [...first, ...early, ...again].slice(0, max);
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
 * Reviews are whatever is due, each practised inside a sentence made only of
 * things the learner already knows, and they come first. New material comes
 * off the theme's ladder in order, at most `maxNew` things per session and
 * fewer the more there is to review (`roomForNew`).
 */
export function planSession(
  content: ThemeContent,
  knowledge: Map<string, KnowledgeState>,
  opts: PlanOptions,
): SessionPlan {
  const { now, stretch = 0, maxNew = newPerSession(stretch, DEFAULT_MAX_NEW), maxReview = DEFAULT_MAX_REVIEW, minExercises = 6 } = opts;
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

  // Something introduced in this session is not in `knowledge` yet: it starts new in every skill.
  const subjectOf = (target: Target): ExerciseSubject => {
    const skills = (knowledge.get(targetKey(target)) ?? introducedState(now)).skills;
    if (target.kind === "pattern") return { fa: null, label: content.patterns.get(target.id)?.title ?? "", skills };
    const lexeme = content.lexemes.get(target.id);
    return { fa: lexeme?.voc ?? null, label: lexeme?.gloss ?? "", skills };
  };

  const graded = (s: Sentence, primary: Target | null) => {
    usedSentences.add(s.id);
    return {
      sentence: display(s),
      primary,
      others: componentsOf(s).filter((c) => !primary || targetKey(c) !== targetKey(primary)),
      ...(primary ? { subject: subjectOf(primary) } : {}),
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

  const saidAlone = (lexemeId: string) => !opts.unspeakable?.has(lexemeId);

  /** The word is heard; the learner picks which written word it was, from ones that sound like it. */
  const hearPick = (s: Sentence, lexemeId: string): ChoiceExercise => {
    const lexeme = content.lexemes.get(lexemeId)!;
    const pool = shuffle([...content.lexemes.values()]).filter((l) => l.fa !== lexeme.fa && l.translit !== lexeme.translit);
    const mixedUp = new Set(confusedWith(lexemeId).map((l) => l.id));
    // Words met before others: an unknown word is ruled out without listening.
    const rank = (l: (typeof pool)[number]) =>
      (mixedUp.has(l.id) ? -100 : 0) + (known.has(`lexeme:${l.id}`) ? 0 : 50) + soundDistance(lexeme.translit, l.translit);
    const distractors = pool.sort((a, b) => rank(a) - rank(b)).map((l) => l.fa);
    return {
      type: "choice",
      variant: "hear-pick",
      key: nextKey("hear-pick"),
      ...graded(s, { kind: "lexeme", id: lexemeId }),
      ...withOptions(lexeme.fa, [...new Set(distractors)]),
      tokenIndex: s.tokens.findIndex((t) => t.lexemeId === lexemeId),
      wordAudioUrl: audioUrl(wordClip(lexeme)),
    };
  };

  /**
   * The word is shown as it is written, without vowel marks; the learner picks
   * how it is said. Null where the letters leave no doubt, or too little to
   * make a question of.
   */
  const pronounce = (s: Sentence, lexemeId: string): ChoiceExercise | null => {
    const tokenIndex = s.tokens.findIndex((t) => t.lexemeId === lexemeId);
    const correct = s.tokens[tokenIndex].translit;
    const readings = shuffle(otherReadings(correct));
    if (readings.length < 2) return null;
    return {
      type: "choice",
      variant: "pronounce",
      key: nextKey("pronounce"),
      ...graded(s, { kind: "lexeme", id: lexemeId }),
      ...withOptions(correct, readings),
      tokenIndex,
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

  /**
   * A sentence that shows a grammar point is given with the word that shows
   * it left out and that word in its plain form beside it; the learner picks
   * the form the grammar calls for. Null if the sentence does not show the
   * point in a way the form rules can vouch for, or leaves too little to pick from.
   */
  const transform = (s: Sentence, patternId: string): ChoiceExercise | null => {
    const found = formToken(s, content.lexemes, patternId);
    if (!found) return null;
    const { index, form, lexeme } = found;
    const correct = s.tokens[index].fa;
    // The word left as it was, its other forms, and the same form of the same verb for someone else.
    const siblings = lexeme.lemma
      ? shuffle([...content.lexemes.values()]).filter((l) => l.lemma === lexeme.lemma && l.id !== lexeme.id && known.has(`lexeme:${l.id}`))
      : [];
    const wrong = [
      lexeme.fa,
      ...shuffle(formsFor(lexeme).filter((other) => other !== form && FORM_ASK[other])).flatMap((other) => applyForm(lexeme, other)?.fa ?? []),
      ...siblings.flatMap((l) => [applyForm(l, form)?.fa ?? [], l.fa]).flat(),
      // Not a verb that is negative already (نیستم): the rule would make a word that does not exist.
    ]
      .filter((fa) => !(form === "negated" && fa.startsWith("نن")))
      .filter((fa) => fa !== correct);
    const distractors = [...new Set(wrong)];
    if (distractors.length < 2) return null;
    return {
      type: "choice",
      variant: "transform",
      key: nextKey("transform"),
      ...graded(s, { kind: "pattern", id: patternId }),
      ...withOptions(correct, distractors),
      tokenIndex: index,
      base: { fa: lexeme.fa, voc: lexeme.voc, showVowels: showVowels(lexeme.id) },
      instruction: FORM_ASK[form],
    };
  };

  /**
   * Something is said, heard or read according to the skill, and the learner
   * picks what to say back. The wrong answers are replies to other things
   * altogether, so none of them could pass as an answer to this.
   */
  const reply = (s: Sentence, primary: Target, variant: "reply-heard" | "reply-read"): ChoiceExercise | null => {
    const answers = shuffle(repliesTo(s));
    if (answers.length === 0) return null;
    // Whatever shares a reply with this is too near it: "Are you well?" beside "How are you?".
    const near = new Set(answers.flatMap((r) => r.replyTo ?? []));
    const text = (r: Sentence) => sentenceText(r);
    const right = new Set(repliesTo(s).map(text));
    const others = shuffle(content.sentences.filter((r) => isEligible(r) && (r.replyTo ?? []).length > 0 && !r.replyTo!.some((id) => near.has(id))))
      .map(text)
      .filter((option) => !right.has(option));
    const distractors = [...new Set(others)];
    if (distractors.length < 2) return null;
    return {
      type: "choice",
      variant,
      key: nextKey(variant),
      ...graded(s, primary),
      ...withOptions(text(answers[0]), distractors),
      reply: display(answers[0]),
    };
  };

  const tiles = (s: Sentence, primary: Target | null, variant: TilesExercise["variant"] = "tiles"): TilesExercise => {
    const d = display(s);
    const inSentence = new Set(s.tokens.map((t) => t.fa));
    const extras = shuffle([...content.lexemes.values()])
      .filter((l) => known.has(`lexeme:${l.id}`) && !inSentence.has(l.fa))
      .slice(0, 2)
      .map((l) => ({ fa: l.fa, voc: l.voc, showVowels: showVowels(l.id) }));
    return {
      type: "tiles",
      variant,
      key: nextKey(variant),
      ...graded(s, primary),
      tiles: shuffle([...d.tokens.map((t) => ({ fa: t.fa, voc: t.voc, showVowels: t.showVowels })), ...extras]),
      // Heard, a sentence is right only as it was said; from its meaning, any way of saying it is.
      accepted: variant === "dictation" ? [{ text: spokenWords(s) }] : acceptedAnswers(s, withAlternates),
    };
  };

  const isEligible = (s: Sentence) => componentsOf(s).every((c) => known.has(targetKey(c)));
  /** The replies to a sentence that the learner could read. */
  const repliesTo = (s: Sentence) => content.sentences.filter((r) => r.replyTo?.includes(s.id) && isEligible(r));

  // --- Reviews: decided before anything new is marked known, so a review
  // never leans on a word introduced later in the same session. ---
  const due = dueTargets(knowledge, now, maxReview, opts.weak, opts.recent);
  const ahead = aheadBy(stretch);

  /** An exercise on one skill of something the learner has met, or null if nothing here can ask about it. */
  const review = ({ key, skill, state }: Due): Exercise | null => {
    const kind = key.slice(0, key.indexOf(":")) as Target["kind"];
    const id = key.slice(key.indexOf(":") + 1);
    const target: Target = { kind, id };
    const containing = content.sentences.filter(
      (s) => isEligible(s) && (kind === "lexeme" ? s.lexemeIds : s.patternIds).includes(id),
    );
    if (containing.length === 0) return null; // belongs to another theme
    const fresh = containing.filter((s) => !usedSentences.has(s.id));
    const candidates = fresh.length > 0 ? fresh : containing;
    // There is nothing to build in a sentence of one word.
    const longer = candidates.filter((s) => s.tokens.length >= 2);
    const ordered = leastSeen(skill === "producing" && longer.length > 0 ? longer : candidates);
    const word = kind === "lexeme";
    // A learner getting nearly everything right is asked the harder ways sooner.
    const reps = state.repetitions + ahead;
    const coin = rand() < 0.5;

    // Ways of asking that only some sentences allow are tried first, in the
    // least-seen sentence that allows them: a grammar point by changing a
    // word's form, and something understood by choosing what to say back.
    let special: ChoiceExercise | null = null;
    if (skill === "producing" && !word && (reps <= 1 || coin)) {
      for (const candidate of ordered) if ((special = transform(candidate, id))) break;
    } else if (skill !== "producing" && reps >= 1 && coin) {
      for (const candidate of ordered) if ((special = reply(candidate, target, skill === "listening" ? "reply-heard" : "reply-read"))) break;
    }
    if (special) return special;
    const s = ordered[0];
    const multiWord = s.tokens.length >= 2;

    // A word is met alone first and then in a sentence, each skill has its
    // own ways of asking, and the ways get harder as the word settles.
    if (skill === "listening") {
      const alone = word && saidAlone(id);
      if (alone && reps <= 1 && coin) return wordChoice(s, id, "hear-word");
      if (alone && reps === 2 && coin) return hearPick(s, id);
      if (reps >= VOWEL_FADE_REPS && multiWord && coin) return tiles(s, target, "dictation");
      return meaningChoice(s, target, "listen");
    }
    if (skill === "reading") {
      // Once its vowel marks are gone, whether the word can still be sounded out is worth asking.
      const sounding = word && reps >= VOWEL_FADE_REPS && coin ? pronounce(s, id) : null;
      if (sounding) return sounding;
      return word && reps <= 1 && coin ? wordChoice(s, id, "read-word") : meaningChoice(s, target, "read");
    }
    if (word && (reps <= 1 || !multiWord)) return pickWord(s, id);
    if (word && reps === 2) return cloze(s, id);
    return tiles(s, target);
  };

  // What is due now. Weak things that are not due yet wait until the end, and
  // only fill a session that has nothing new to teach: going over what is not
  // due is no use to a learner who could be learning something.
  const reviews = due.filter((item) => !item.early).flatMap((item) => review(item) ?? []);

  // --- New material, in ladder order, in whatever room the reviews leave. ---
  const room = roomForNew(reviews.length, maxNew, maxReview);
  const blocks: Exercise[][] = [];
  const deferred: Exercise[] = [];
  let newCount = 0;
  let newHeldBack = false;
  for (const s of content.sentences) {
    if (!s.ladder) continue;
    const unknown = componentsOf(s).filter((c) => !known.has(targetKey(c)));
    if (unknown.length === 0) continue;
    if (newCount + unknown.length > room) {
      newHeldBack = newCount + unknown.length <= maxNew;
      break;
    }
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
          // Recognising a word just shown is near certain; a learner getting most things right skips it.
          ...(stretch >= 0.5 ? [] : [wordChoice(s, target.id, "read-word")]),
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

  // --- Everything due, then each new thing, then the harder
  // sentence-building for the new things once they have settled. By the end
  // each new thing has been asked for in all three skills. ---
  const exercises: Exercise[] = [...reviews, ...blocks.flat(), ...deferred];

  // --- Room left: weak things not due yet, then ungraded practice, so a session is never empty. ---
  let early = 0;
  for (const item of due.filter((d) => d.early)) {
    if (exercises.length >= minExercises) break;
    const exercise = review(item);
    if (exercise) {
      exercises.push(exercise);
      early++;
    }
  }
  if (exercises.length < minExercises) {
    const spare = leastSeen(content.sentences.filter((s) => isEligible(s) && !usedSentences.has(s.id)));
    for (const s of spare) {
      if (exercises.length >= minExercises) break;
      const roll = rand();
      exercises.push(s.tokens.length >= 2 && roll < 0.4 ? tiles(s, null) : meaningChoice(s, null, roll < 0.7 ? "listen" : "read"));
    }
  }

  return { exercises, newCount, reviewCount: reviews.length + early, newHeldBack };
}
