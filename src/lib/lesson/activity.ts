// Kept apart from journey.ts so the browser can import it without the server-side lesson code.

/** One hour of answering, as stored: when, how many, how many right. */
export type ActivityHour = { at: number; total: number; correct: number };
export type ActivityDay = { date: string; total: number; correct: number };

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * The last `days` calendar days in the caller's own time zone, oldest first,
 * and how many days running the learner has practised. A streak still counts
 * if today has not been practised yet: it is only broken by a missed day.
 */
export function dailyActivity(hours: ActivityHour[], now: Date, days: number): { days: ActivityDay[]; streak: number } {
  const byDay = new Map<string, { total: number; correct: number }>();
  for (const hour of hours) {
    const key = dayKey(new Date(hour.at));
    const day = byDay.get(key) ?? { total: 0, correct: 0 };
    byDay.set(key, { total: day.total + hour.total, correct: day.correct + hour.correct });
  }
  const back = (n: number) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));

  let streak = 0;
  for (let n = byDay.has(back(0)) ? 0 : 1; byDay.has(back(n)); n++) streak++;

  return {
    days: Array.from({ length: days }, (_, i) => {
      const date = back(days - 1 - i);
      return { date, ...(byDay.get(date) ?? { total: 0, correct: 0 }) };
    }),
    streak,
  };
}
