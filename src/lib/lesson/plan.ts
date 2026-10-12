import { audioUrl, clipSpec, wordClip, type ClipSpec } from "@/lib/audio-key";
import { acceptedAnswers } from "./variants";
import {
  targetKey,
  type ChoiceExercise,
  type DisplaySentence,
  type Exercise,
  type KnowledgeState,
  type Sentence,
  type SessionPlan,
  type Target,
  type ThemeContent,
  type TilesExercise,
} from "./types";

/** Short-vowel marks stay on a word until it has survived this many reviews. */
export const VOWEL_FADE_REPS = 3;

export type PlanOptions = {
  now: Date;
  seed: number;
  maxNew?: number;
  maxReview?: number;
  minExercises?: number;
};

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
  const { now, maxNew = 3, maxReview = 8, minExercises = 6 } = opts;
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
  let counter = 0;
  const nextKey = (label: string) => `${label}-${counter++}`;

  const display = (s: Sentence): DisplaySentence => ({
    id: s.id,
    tokens: s.tokens.map((t) => ({
      ...t,
      gloss: content.lexemes.get(t.lexemeId)?.gloss ?? "",
      showVowels: (knowledge.get(`lexeme:${t.lexemeId}`)?.repetitions ?? 0) < VOWEL_FADE_REPS,
    })),
    endPunct: s.endPunct,
    english: s.english,
    translit: s.tokens.map((t) => t.translit + (t.after ? "," : "")).join(" "),
    note: s.note,
    audioUrl: audioUrl(sentenceClip(s)),
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

  const meaningChoice = (s: Sentence, primary: Target | null, variant: "listen" | "read"): ChoiceExercise => {
    const seen = new Set([s.english]);
    const others = shuffle(content.sentences)
      .filter((o) => !seen.has(o.english) && seen.add(o.english))
      // Near-length sentences make more plausible wrong answers.
      .sort((a, b) => Math.abs(a.tokens.length - s.tokens.length) - Math.abs(b.tokens.length - s.tokens.length))
      .map((o) => o.english);
    return { type: "choice", variant, key: nextKey(variant), ...graded(s, primary), ...withOptions(s.english, others) };
  };

  const wordChoice = (s: Sentence, lexemeId: string): ChoiceExercise => {
    const lexeme = content.lexemes.get(lexemeId)!;
    const glosses = shuffle([...content.lexemes.values()])
      .filter((l) => l.gloss !== lexeme.gloss)
      .map((l) => l.gloss);
    return {
      type: "choice",
      variant: "word",
      key: nextKey("word"),
      ...graded(s, { kind: "lexeme", id: lexemeId }),
      ...withOptions(lexeme.gloss, [...new Set(glosses)]),
      tokenIndex: s.tokens.findIndex((t) => t.lexemeId === lexemeId),
      wordAudioUrl: audioUrl(wordClip(lexeme)),
    };
  };

  const cloze = (s: Sentence, lexemeId: string): ChoiceExercise => {
    const tokenIndex = s.tokens.findIndex((t) => t.lexemeId === lexemeId);
    const correct = s.tokens[tokenIndex].fa;
    const lexeme = content.lexemes.get(lexemeId)!;
    const pool = shuffle([...content.lexemes.values()]).filter((l) => l.fa !== correct && l.id !== lexemeId);
    // Other forms of the same verb first, then words the learner has met.
    const rank = (l: (typeof pool)[number]) =>
      lexeme.lemma && l.lemma === lexeme.lemma ? 0 : known.has(`lexeme:${l.id}`) ? 1 : 2;
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
      .map((l) => ({ fa: l.fa, voc: l.voc, showVowels: (knowledge.get(`lexeme:${l.id}`)?.repetitions ?? 0) < VOWEL_FADE_REPS }));
    return {
      type: "tiles",
      key: nextKey("tiles"),
      ...graded(s, primary),
      tiles: shuffle([...d.tokens.map((t) => ({ fa: t.fa, voc: t.voc, showVowels: t.showVowels })), ...extras]),
      accepted: acceptedAnswers(s, content),
    };
  };

  const isEligible = (s: Sentence) => componentsOf(s).every((c) => known.has(targetKey(c)));

  // --- Reviews: decided before anything new is marked known, so a review
  // never leans on a word introduced later in the same session. ---
  const due = [...knowledge.entries()]
    .filter(([, state]) => state.dueAt <= now)
    .sort((a, b) => a[1].dueAt.getTime() - b[1].dueAt.getTime())
    .slice(0, maxReview);

  const reviews: Exercise[] = [];
  for (const [key, state] of due) {
    const kind = key.slice(0, key.indexOf(":")) as Target["kind"];
    const id = key.slice(key.indexOf(":") + 1);
    const target: Target = { kind, id };
    const containing = content.sentences.filter(
      (s) => isEligible(s) && (kind === "lexeme" ? s.lexemeIds : s.patternIds).includes(id),
    );
    if (containing.length === 0) continue; // belongs to another theme
    const fresh = containing.filter((s) => !usedSentences.has(s.id));
    const s = shuffle(fresh.length > 0 ? fresh : containing)[0];
    const multiWord = s.tokens.length >= 2;
    const reps = state.repetitions;

    if (reps >= 3 && multiWord) reviews.push(tiles(s, target));
    else if (kind === "lexeme" && reps === 2 && multiWord) reviews.push(cloze(s, id));
    else if (kind === "lexeme" && reps <= 1 && rand() < 0.5) reviews.push(wordChoice(s, id));
    else reviews.push(meaningChoice(s, target, kind === "pattern" && reps <= 1 ? "read" : "listen"));
  }

  // --- New material, in ladder order. ---
  const blocks: Exercise[][] = [];
  const deferred: Exercise[] = [];
  let newCount = 0;
  for (const s of content.sentences) {
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
          wordChoice(s, target.id),
          meaningChoice(s, target, "listen"),
        ]);
      } else {
        blocks.push([
          {
            type: "intro-pattern",
            key: nextKey("intro"),
            target,
            pattern: content.patterns.get(target.id)!,
            sentence: display(s),
          },
          meaningChoice(s, target, "listen"),
        ]);
      }
      if (s.tokens.length >= 2) deferred.push(tiles(s, target));
    }
  }

  // --- Interleave: a couple of reviews before each new thing, then the
  // harder sentence-building for the new things once they have settled. ---
  const exercises: Exercise[] = [];
  let r = 0;
  for (const block of blocks) {
    exercises.push(...reviews.slice(r, r + 2), ...block);
    r += 2;
  }
  exercises.push(...reviews.slice(r), ...deferred);

  // --- Nothing due and nothing new: ungraded practice so a session is never empty. ---
  if (exercises.length < minExercises) {
    const spare = shuffle(content.sentences.filter((s) => isEligible(s) && !usedSentences.has(s.id)));
    for (const s of spare) {
      if (exercises.length >= minExercises) break;
      exercises.push(s.tokens.length >= 2 && rand() < 0.5 ? tiles(s, null) : meaningChoice(s, null, "listen"));
    }
  }

  return { exercises, newCount, reviewCount: reviews.length };
}
