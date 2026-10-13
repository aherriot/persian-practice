import { and, desc, eq, gt, inArray, isNotNull, isNull, like, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { lexemes, reviewLog } from "@/lib/db/schema";
import type { ActivityHour } from "./activity";
import type { ConfusionRow } from "./confusions";

/** Streaks are counted from this much history, so they top out here. */
export const HISTORY_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A learner's answers since `since`, added up by the hour. Hours rather than
 * days because a "day" is the learner's own and the server does not know their
 * time zone: the browser turns these into days (see dailyActivity).
 */
export async function loadActivityHours(userId: string, now: Date, days = HISTORY_DAYS): Promise<ActivityHour[]> {
  const hour = sql<string>`date_trunc('hour', ${reviewLog.createdAt})`;
  const rows = await db
    .select({
      at: sql<number>`(extract(epoch from ${hour}) * 1000)::float8`,
      total: sql<number>`count(*)::int`,
      correct: sql<number>`count(*) filter (where ${reviewLog.correct})::int`,
    })
    .from(reviewLog)
    .where(and(eq(reviewLog.userId, userId), gt(reviewLog.createdAt, new Date(now.getTime() - days * DAY_MS))))
    .groupBy(hour);
  return rows.map((row) => ({ at: Number(row.at), total: row.total, correct: row.correct }));
}

/** Mix-ups are read from this much history: an old confusion, since put right, drops out. */
export const CONFUSION_DAYS = 90;
const CONFUSION_ROWS = 200;

/**
 * The wrong answers a learner has picked in the two exercises that are about
 * one word, matched back to the word each wrong answer belongs to: by meaning
 * for "what does this word mean", by spelling for "which word is missing".
 * Counted per pair, the most frequent first. Answers from before picks were
 * recorded have none and are not counted.
 */
export async function loadConfusions(userId: string, now: Date, days = CONFUSION_DAYS): Promise<ConfusionRow[]> {
  // Written into the query rather than passed in: Postgres only sees the
  // selected expression as grouped if it is the same text each time.
  const targetId = sql<string>`substr(${reviewLog.target}, ${sql.raw(String("lexeme:".length + 1))})`;
  const times = sql<number>`count(*)::int`;
  return db
    .select({ targetId, pickedId: lexemes.id, picked: sql<string>`${reviewLog.picked}`, exercise: reviewLog.exercise, times })
    .from(reviewLog)
    .innerJoin(
      lexemes,
      or(
        and(eq(reviewLog.exercise, "word"), eq(lexemes.gloss, reviewLog.picked)),
        and(eq(reviewLog.exercise, "cloze"), eq(lexemes.fa, reviewLog.picked)),
      ),
    )
    .where(
      and(
        eq(reviewLog.userId, userId),
        eq(reviewLog.correct, false),
        isNotNull(reviewLog.picked),
        like(reviewLog.target, "lexeme:%"),
        inArray(reviewLog.exercise, ["word", "cloze"]),
        gt(reviewLog.createdAt, new Date(now.getTime() - days * DAY_MS)),
        or(isNull(lexemes.ownerId), eq(lexemes.ownerId, userId)),
        ne(lexemes.id, targetId),
      ),
    )
    .groupBy(reviewLog.target, lexemes.id, reviewLog.picked, reviewLog.exercise)
    .orderBy(desc(times), lexemes.id)
    .limit(CONFUSION_ROWS);
}
