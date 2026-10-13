import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { reviewLog } from "@/lib/db/schema";
import type { ActivityHour } from "./activity";

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
