import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { knowledge, lexemes, patterns, reviewLog, sentences, themes } from "@/lib/db/schema";
import { checkAnswer, type Submission } from "./check";
import { applyAnswer, introducedSkill } from "./grade";
import { componentsOf } from "./plan";
import {
  EXERCISE_SKILL,
  knowledgeOf,
  SKILLS,
  targetKey,
  type Kind,
  type KnowledgeState,
  type Lexeme,
  type Pattern,
  type Sentence,
  type Skill,
  type SkillState,
  type Target,
} from "./types";

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
  sql`(select distinct ${knowledge.refId} from ${knowledge} where ${knowledge.userId} = ${userId} and ${knowledge.kind} = ${kind})`;

/** Every id in an array column is one of `ids` (a subquery or a list). */
export const allIn = (column: AnyPgColumn, ids: SQL) =>
  sql`not exists (select 1 from unnest(${column}) as used(id) where used.id not in ${ids})`;

/** A sentence made only of what the learner has met. */
export const eligibleSentence = (userId: string) =>
  and(allIn(sentences.lexemeIds, knownIds(userId, "lexeme")), allIn(sentences.patternIds, knownIds(userId, "pattern")))!;

/**
 * Every sentence the learner has that means one of `english`. Sentence-building
 * has to accept each of them, whichever one the exercise was made from.
 */
export const sameMeaning = (userId: string, english: string[]) => and(visibleSentence(userId), inArray(sentences.english, english))!;

/** The ids of the words used by the sentences matching `where`, as a subquery. */
export const wordsOf = (where: SQL) => sql`(select unnest(${sentences.lexemeIds}) from ${sentences} where ${where})`;

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

const onlyTargets = (only?: Target[]) =>
  only ? inArray(sql`${knowledge.kind} || ':' || ${knowledge.refId}`, only.map(targetKey)) : undefined;

/** What the learner has met, each thing with the state of all its skills. */
export async function loadKnowledge(userId: string, only?: Target[]): Promise<Map<string, KnowledgeState>> {
  const rows = await db
    .select()
    .from(knowledge)
    .where(and(eq(knowledge.userId, userId), onlyTargets(only)));
  const skills = new Map<string, Partial<Record<Skill, SkillState>>>();
  for (const row of rows) {
    const key = targetKey({ kind: row.kind, id: row.refId });
    skills.set(key, { ...skills.get(key), [row.skill]: row });
  }
  return new Map([...skills].map(([key, states]) => [key, knowledgeOf(states)]));
}

/** The state of one skill for each of `only`. */
export async function loadSkill(userId: string, skill: Skill, only: Target[]): Promise<Map<string, SkillState>> {
  if (only.length === 0) return new Map();
  const rows = await db
    .select()
    .from(knowledge)
    .where(and(eq(knowledge.userId, userId), eq(knowledge.skill, skill), onlyTargets(only)));
  return new Map(rows.map((row) => [targetKey({ kind: row.kind, id: row.refId }), row]));
}

/** Marks something as met, in every skill. Safe to repeat: a second introduction changes nothing. */
export async function introduce(userId: string, target: Target, now = new Date()): Promise<void> {
  await db
    .insert(knowledge)
    .values(SKILLS.map((skill) => ({ userId, kind: target.kind, refId: target.id, skill, ...introducedSkill(now) })))
    .onConflictDoNothing();
}

export type AnswerResult = { ok: true; correct: boolean; duplicate: boolean } | { ok: false; reason: string };

/**
 * Marks what the learner did and records it. The browser says only what was
 * picked or built; whether that was right, and what it says about each word in
 * the sentence, is worked out here.
 *
 * `key` identifies the answer. The browser sends an answer again when it
 * cannot tell whether the first attempt arrived, so the same key may come
 * twice; the second changes nothing.
 */
export async function recordAnswer(userId: string, submission: Submission, key: string, now = new Date()): Promise<AnswerResult> {
  // A sentence retired since the session was planned can still be answered.
  const [sentence] = await db
    .select()
    .from(sentences)
    .where(and(eq(sentences.id, submission.sentenceId), or(isNull(sentences.ownerId), eq(sentences.ownerId, userId))))
    .limit(1);
  if (!sentence) return { ok: false, reason: "unknown sentence" };

  const building = submission.exercise === "tiles";
  // Only the skill the exercise tested is moved by the answer.
  const skill = EXERCISE_SKILL[submission.exercise];
  const [alternates, lexemeRows, states] = await Promise.all([
    building
      ? db.select().from(sentences).where(and(sameMeaning(userId, [sentence.english]), ne(sentences.id, sentence.id)))
      : [],
    db
      .select()
      .from(lexemes)
      .where(
        and(
          visibleLexeme(userId),
          building
            ? // As in loadSession: the words of every way of saying it, and the pronouns an answer may add or drop.
              or(inArray(lexemes.id, wordsOf(sameMeaning(userId, [sentence.english]))), isNotNull(lexemes.subjectPronoun))
            : inArray(lexemes.id, sentence.lexemeIds),
        ),
      ),
    loadSkill(userId, skill, componentsOf(sentence)),
  ]);

  const verdict = checkAnswer(
    sentence,
    { sentences: [sentence, ...alternates], lexemes: new Map(lexemeRows.map((l) => [l.id, l])), patterns: new Map() },
    submission,
  );
  if (!verdict.ok) return verdict;
  const updates = applyAnswer(states, verdict.primary, verdict.others, verdict.correct, now);

  // One statement, so the log entry and the schedule changes happen together or
  // not at all (the HTTP driver has no transactions to hold them together
  // otherwise). The schedule moves only if the log entry is new, which is what
  // makes a repeated key harmless, and only for items still as they were read
  // above: if another answer got to one first, it is no longer due and this
  // answer would not have moved it anyway.
  const logged = sql`
    insert into ${reviewLog} ("id", "userId", "sentenceId", "exercise", "correct", "target", "picked", "key")
    values (${crypto.randomUUID()}, ${userId}, ${sentence.id}, ${submission.exercise}, ${verdict.correct},
      ${verdict.primary ? targetKey(verdict.primary) : null}, ${verdict.picked}, ${key})
    on conflict ("key") do nothing
    returning "id"`;
  const moves = [...updates].map(([target, next]) => {
    const was = states.get(target)!;
    const kind = target.slice(0, target.indexOf(":"));
    const refId = target.slice(target.indexOf(":") + 1);
    return sql`(${kind}, ${refId}, ${next.stability}::real, ${next.difficulty}::real, ${next.intervalDays}::real, ${next.repetitions}::int,
      ${next.lapses}::int, ${next.dueAt.toISOString()}::timestamp, ${was.dueAt.toISOString()}::timestamp, ${was.lapses}::int)`;
  });
  const moved =
    moves.length === 0
      ? sql``
      : sql`, moved as (
          update ${knowledge} k
          set "stability" = v."stability", "difficulty" = v."difficulty", "intervalDays" = v."intervalDays",
            "repetitions" = v."repetitions", "lapses" = v."lapses", "dueAt" = v."dueAt", "lastReviewedAt" = ${now.toISOString()}::timestamp
          from (values ${sql.join(moves, sql`, `)})
            as v("kind", "refId", "stability", "difficulty", "intervalDays", "repetitions", "lapses", "dueAt", "wasDueAt", "wasLapses")
          where k."userId" = ${userId} and k."kind" = v."kind" and k."refId" = v."refId" and k."skill" = ${skill}
            and k."dueAt" = v."wasDueAt" and k."lapses" = v."wasLapses"
            and exists (select 1 from logged)
          returning 1
        )`;
  const result = await db.execute<{ logged: number }>(sql`with logged as (${logged})${moved} select count(*)::int as "logged" from logged`);
  return { ok: true, correct: verdict.correct, duplicate: result.rows[0].logged === 0 };
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

/** `knowledge` spares the query when the caller has already loaded it. */
export async function themeSummaries(
  userId: string,
  now = new Date(),
  knowledge?: Map<string, KnowledgeState>,
): Promise<ThemeSummary[]> {
  const [themeRows, sentenceRows, known] = await Promise.all([
    db.select().from(themes).where(visibleTheme(userId)).orderBy(asc(themes.position)),
    db
      .select({ themeId: sentences.themeId, lexemeIds: sentences.lexemeIds, patternIds: sentences.patternIds })
      .from(sentences)
      .where(and(visibleSentence(userId), eq(sentences.ladder, true))),
    knowledge ?? loadKnowledge(userId),
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
