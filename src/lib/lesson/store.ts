import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { knowledge, lexemes, patterns, reviewLog, sentences, themes } from "@/lib/db/schema";
import { applyAnswer, introducedState } from "./grade";
import { targetKey, type KnowledgeState, type Target, type ThemeContent } from "./types";

/** Lexemes and themes are visible when curated (no owner) or the learner's own. */
const visibleLexeme = (userId: string) => or(isNull(lexemes.ownerId), eq(lexemes.ownerId, userId));
const visibleTheme = (userId: string) => or(isNull(themes.ownerId), eq(themes.ownerId, userId));

/**
 * Everything the learner can be taught, as one ladder, by theme position:
 * the words they added themselves first (they asked for those), the curated
 * themes, then what the app has added to take them further. Off-ladder
 * generated sentences come last.
 */
export async function loadAllContent(userId: string): Promise<ThemeContent> {
  const [themeRows, sentenceRows, lexemeRows, patternRows] = await Promise.all([
    db.select({ id: themes.id, ownerId: themes.ownerId }).from(themes).where(visibleTheme(userId)).orderBy(asc(themes.position)),
    db.select().from(sentences).where(eq(sentences.retired, false)).orderBy(asc(sentences.position)),
    db.select().from(lexemes).where(visibleLexeme(userId)),
    db.select().from(patterns).orderBy(asc(patterns.position)),
  ]);
  const themeOrder = new Map(themeRows.map((theme, index) => [theme.id, index]));
  const lexemeMap = new Map(lexemeRows.map((l) => [l.id, l]));
  const rank = (s: { themeId: string | null }) => (s.themeId ? themeOrder.get(s.themeId) : themeRows.length);
  return {
    sentences: sentenceRows
      // Drops other learners' themes, and anything using a word this learner cannot see.
      .filter((s) => rank(s) !== undefined && s.lexemeIds.every((id) => lexemeMap.has(id)))
      .sort((a, b) => rank(a)! - rank(b)!),
    lexemes: lexemeMap,
    patterns: new Map(patternRows.map((p) => [p.id, p])),
  };
}

/** One theme's ladder, plus the generated sentences built entirely from its words. */
export async function loadTheme(themeId: string, userId: string): Promise<ThemeContent | null> {
  const [all, rows] = await Promise.all([
    loadAllContent(userId),
    db.select({ id: sentences.id }).from(sentences).where(eq(sentences.themeId, themeId)),
  ]);
  const own = new Set(rows.map((row) => row.id));
  // Empty for another learner's theme: loadAllContent has already left its sentences out.
  const ladder = all.sentences.filter((s) => own.has(s.id));
  if (ladder.length === 0) return null;
  const lexemeIds = new Set(ladder.flatMap((s) => s.lexemeIds));
  const patternIds = new Set(ladder.flatMap((s) => s.patternIds));
  const mixed = all.sentences.filter(
    (s) =>
      !own.has(s.id) &&
      !s.ladder &&
      s.lexemeIds.every((id) => lexemeIds.has(id)) &&
      s.patternIds.every((id) => patternIds.has(id)),
  );
  return {
    sentences: [...ladder, ...mixed],
    lexemes: new Map([...all.lexemes].filter(([id]) => lexemeIds.has(id))),
    patterns: new Map([...all.patterns].filter(([id]) => patternIds.has(id))),
  };
}

/** How many times the learner has answered each sentence. */
export async function loadSeen(userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ sentenceId: reviewLog.sentenceId, count: sql<number>`count(*)::int` })
    .from(reviewLog)
    .where(eq(reviewLog.userId, userId))
    .groupBy(reviewLog.sentenceId);
  return new Map(rows.flatMap((row) => (row.sentenceId ? [[row.sentenceId, row.count] as const] : [])));
}

/** Takes a generated sentence out of circulation for everyone. Hand-written sentences are left alone. */
export async function retireSentence(sentenceId: string): Promise<void> {
  await db.update(sentences).set({ retired: true }).where(and(eq(sentences.id, sentenceId), eq(sentences.generated, true)));
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
      .where(eq(sentences.ladder, true)),
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
