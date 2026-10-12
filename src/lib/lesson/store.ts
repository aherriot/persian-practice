import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { knowledge, lexemes, patterns, reviewLog, sentences, themes } from "@/lib/db/schema";
import { applyAnswer, introducedState } from "./grade";
import { targetKey, type KnowledgeState, type Target, type ThemeContent } from "./types";

export async function loadTheme(themeId: string): Promise<ThemeContent | null> {
  const rows = await db.select().from(sentences).where(eq(sentences.themeId, themeId)).orderBy(asc(sentences.position));
  if (rows.length === 0) return null;
  const lexemeIds = [...new Set(rows.flatMap((s) => s.lexemeIds))];
  const patternIds = [...new Set(rows.flatMap((s) => s.patternIds))];
  const [lexemeRows, patternRows] = await Promise.all([
    db.select().from(lexemes).where(inArray(lexemes.id, lexemeIds)),
    patternIds.length > 0 ? db.select().from(patterns).where(inArray(patterns.id, patternIds)) : [],
  ]);
  return {
    sentences: rows,
    lexemes: new Map(lexemeRows.map((l) => [l.id, l])),
    patterns: new Map(patternRows.map((p) => [p.id, p])),
  };
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
    db.select().from(themes).orderBy(asc(themes.position)),
    db.select({ themeId: sentences.themeId, lexemeIds: sentences.lexemeIds, patternIds: sentences.patternIds }).from(sentences),
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
