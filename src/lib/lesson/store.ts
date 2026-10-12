import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { knowledge, lexemes, patterns, reviewLog, sentences, themes } from "@/lib/db/schema";
import { applyAnswer, introducedState } from "./grade";
import { targetKey, type Kind, type KnowledgeState, type Lexeme, type Pattern, type Sentence, type Target } from "./types";

/** Lexemes, themes and sentences are visible when curated (no owner) or the learner's own. */
export const visibleLexeme = (userId: string) => or(isNull(lexemes.ownerId), eq(lexemes.ownerId, userId))!;
const visibleTheme = (userId: string) => or(isNull(themes.ownerId), eq(themes.ownerId, userId))!;
export const visibleSentence = (userId: string) =>
  and(eq(sentences.retired, false), or(isNull(sentences.ownerId), eq(sentences.ownerId, userId)))!;

// --- Pieces of SQL for asking about sentences without fetching them. ---

export const textArray = (values: string[]) =>
  sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;

/** The ids of what a learner has met, as a subquery. */
export const knownIds = (userId: string, kind: Kind) =>
  sql`(select ${knowledge.refId} from ${knowledge} where ${knowledge.userId} = ${userId} and ${knowledge.kind} = ${kind})`;

/** Every id in an array column is one of `ids` (a subquery or a list). */
export const allIn = (column: AnyPgColumn, ids: SQL) =>
  sql`not exists (select 1 from unnest(${column}) as used(id) where used.id not in ${ids})`;

/** A sentence made only of what the learner has met. */
export const eligibleSentence = (userId: string) =>
  and(allIn(sentences.lexemeIds, knownIds(userId, "lexeme")), allIn(sentences.patternIds, knownIds(userId, "pattern")))!;

export const usesTarget = (target: Target) =>
  sql`${target.kind === "lexeme" ? sentences.lexemeIds : sentences.patternIds} @> ${textArray([target.id])}`;

/** Whether a theme has anything in it for this learner; another learner's theme never does. */
export async function hasSentences(userId: string, themeId: string): Promise<boolean> {
  const rows = await db
    .select({ id: sentences.id })
    .from(sentences)
    .where(and(eq(sentences.themeId, themeId), visibleSentence(userId)))
    .limit(1);
  return rows.length > 0;
}

/** The course without its sentences: every word and grammar note, and which of them the ladder teaches. */
export type Course = {
  lexemes: Map<string, Lexeme>;
  patterns: Map<string, Pattern>;
  /** Target keys ("lexeme:…", "pattern:…") of everything a ladder sentence uses. */
  onLadder: Set<string>;
};

export async function loadCourse(userId: string): Promise<Course> {
  const onLadder = (column: AnyPgColumn, kind: Kind) =>
    db
      .selectDistinct({ id: sql<string>`unnest(${column})` })
      .from(sentences)
      .where(and(visibleSentence(userId), eq(sentences.ladder, true)))
      .then((rows) => rows.map((row) => targetKey({ kind, id: row.id })));
  const [lexemeRows, patternRows, lexemeKeys, patternKeys] = await Promise.all([
    db.select().from(lexemes).where(visibleLexeme(userId)),
    db.select().from(patterns).orderBy(asc(patterns.position)),
    onLadder(sentences.lexemeIds, "lexeme"),
    onLadder(sentences.patternIds, "pattern"),
  ]);
  return {
    lexemes: new Map(lexemeRows.map((l) => [l.id, l])),
    patterns: new Map(patternRows.map((p) => [p.id, p])),
    onLadder: new Set([...lexemeKeys, ...patternKeys]),
  };
}

/**
 * Everything the learner can be taught is one ladder, by theme position: the
 * words they added themselves first (they asked for those), the curated
 * themes, then what the app has added to take them further. Sentences outside
 * any theme come last. For queries that join sentences to their theme.
 */
export const ladderOrder = [sql`${themes.position} nulls last`, asc(themes.id), asc(sentences.position), asc(sentences.id)];

/**
 * Every word and grammar note the learner can look up, words in the order they
 * are taught. Reads only which words each sentence uses, not the sentences, so
 * it stays light however many sentences there are.
 */
export async function loadVocabulary(userId: string): Promise<{ lexemes: Lexeme[]; patterns: Pattern[] }> {
  const [useRows, lexemeRows, patternRows] = await Promise.all([
    db
      .select({ lexemeIds: sentences.lexemeIds })
      .from(sentences)
      .leftJoin(themes, eq(themes.id, sentences.themeId))
      .where(visibleSentence(userId))
      .orderBy(...ladderOrder),
    db.select().from(lexemes).where(visibleLexeme(userId)),
    db.select().from(patterns).orderBy(asc(patterns.position)),
  ]);
  const lexemeMap = new Map(lexemeRows.map((l) => [l.id, l]));
  const taught = new Set(useRows.flatMap((s) => s.lexemeIds));
  return { lexemes: [...taught].flatMap((id) => lexemeMap.get(id) ?? []), patterns: patternRows };
}

/**
 * A few sentences that use a word or pattern, shortest first: the clearest
 * illustration of a word is the one with least else in it.
 */
export async function loadExamples(userId: string, target: Target, limit: number): Promise<Sentence[]> {
  const length = sql`jsonb_array_length(${sentences.tokens})`;
  return db
    .select()
    .from(sentences)
    .where(
      and(
        visibleSentence(userId),
        usesTarget(target),
        // A word on its own illustrates nothing.
        target.kind === "lexeme" ? sql`${length} > 1` : undefined,
      ),
    )
    .orderBy(length, asc(sentences.generated), asc(sentences.position), asc(sentences.id))
    .limit(limit);
}

/** How many of the learner's sentences use each word. `among` narrows which sentences count. */
export async function loadWordUses(userId: string, among: SQL = visibleSentence(userId)): Promise<Map<string, number>> {
  const word = sql<string>`unnest(${sentences.lexemeIds})`;
  const rows = await db.select({ id: word, uses: sql<number>`count(*)::int` }).from(sentences).where(among).groupBy(word);
  return new Map(rows.map((row) => [row.id, row.uses]));
}

/**
 * The learner's sentences made of exactly the same words as one of `wordSets`:
 * all a new sentence can be a repeat of, so the rest need not be read.
 */
export async function loadSameWords(userId: string, wordSets: string[][]): Promise<Sentence[]> {
  if (wordSets.length === 0) return [];
  const same = wordSets.map((ids) => sql`(${sentences.lexemeIds} @> ${textArray(ids)} and ${sentences.lexemeIds} <@ ${textArray(ids)})`);
  return db.select().from(sentences).where(and(visibleSentence(userId), or(...same)));
}

/** Takes a generated sentence the learner was shown out of circulation. Hand-written sentences are left alone. */
export async function retireSentence(userId: string, sentenceId: string): Promise<void> {
  await db
    .update(sentences)
    .set({ retired: true })
    .where(and(eq(sentences.id, sentenceId), eq(sentences.generated, true), visibleSentence(userId)));
}

export async function loadKnowledge(userId: string, only?: Target[]): Promise<Map<string, KnowledgeState>> {
  const rows = await db
    .select()
    .from(knowledge)
    .where(
      and(
        eq(knowledge.userId, userId),
        only ? inArray(sql`${knowledge.kind} || ':' || ${knowledge.refId}`, only.map(targetKey)) : undefined,
      ),
    );
  return new Map(rows.map((row) => [targetKey({ kind: row.kind, id: row.refId }), row]));
}

/** Marks something as met. Safe to repeat: a second introduction changes nothing. */
export async function introduce(userId: string, target: Target, now = new Date()): Promise<void> {
  await db
    .insert(knowledge)
    .values({ userId, kind: target.kind, refId: target.id, ...introducedState(now) })
    .onConflictDoNothing();
}

export type AnswerInput = {
  sentenceId: string;
  exercise: string;
  correct: boolean;
  primary: Target | null;
  others: Target[];
};

export async function recordAnswer(userId: string, input: AnswerInput, now = new Date()): Promise<void> {
  const targets = input.primary ? [input.primary, ...input.others] : input.others;
  const states = targets.length > 0 ? await loadKnowledge(userId, targets) : new Map<string, KnowledgeState>();
  const updates = applyAnswer(states, input.primary, input.others, input.correct, now);

  await Promise.all([
    db.insert(reviewLog).values({
      userId,
      sentenceId: input.sentenceId,
      exercise: input.exercise,
      correct: input.correct,
    }),
    ...[...updates].map(([key, state]) => {
      const kind = key.slice(0, key.indexOf(":")) as Target["kind"];
      const refId = key.slice(key.indexOf(":") + 1);
      return db
        .update(knowledge)
        .set({ ...state, lastReviewedAt: now })
        .where(and(eq(knowledge.userId, userId), eq(knowledge.kind, kind), eq(knowledge.refId, refId)));
    }),
  ]);
}

export type ThemeSummary = {
  id: string;
  title: string;
  titleFa: string;
  description: string;
  total: number;
  learned: number;
  due: number;
};

export async function themeSummaries(userId: string, now = new Date()): Promise<ThemeSummary[]> {
  const [themeRows, sentenceRows, known] = await Promise.all([
    db.select().from(themes).where(visibleTheme(userId)).orderBy(asc(themes.position)),
    db
      .select({ themeId: sentences.themeId, lexemeIds: sentences.lexemeIds, patternIds: sentences.patternIds })
      .from(sentences)
      .where(and(visibleSentence(userId), eq(sentences.ladder, true))),
    loadKnowledge(userId),
  ]);
  return themeRows.map((theme) => {
    const components = new Set(
      sentenceRows
        .filter((s) => s.themeId === theme.id)
        .flatMap((s) => [...s.lexemeIds.map((id) => `lexeme:${id}`), ...s.patternIds.map((id) => `pattern:${id}`)]),
    );
    const mine = [...components].filter((key) => known.has(key));
    return {
      id: theme.id,
      title: theme.title,
      titleFa: theme.titleFa,
      description: theme.description,
      total: components.size,
      learned: mine.length,
      due: mine.filter((key) => known.get(key)!.dueAt <= now).length,
    };
  });
}
