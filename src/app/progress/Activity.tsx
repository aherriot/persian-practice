"use client";

import { useSyncExternalStore } from "react";
import { dailyActivity, type ActivityHour } from "@/lib/lesson/activity";

const DAYS = 14;
const noop = () => () => {};

/**
 * Practice by calendar day. Drawn in the browser because a "day" is the
 * learner's own, and the server does not know their time zone.
 */
export function Activity({ hours }: { hours: ActivityHour[] }) {
  // Nothing on the server or during hydration, so the two cannot disagree about what day it is.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return <div className="h-32" aria-hidden="true" />;

  const { days, streak } = dailyActivity(hours, new Date(), DAYS);
  const week = days.slice(-7).reduce((sum, day) => ({ total: sum.total + day.total, correct: sum.correct + day.correct }), { total: 0, correct: 0 });
  const peak = Math.max(1, ...days.map((day) => day.total));
  const weekday = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink/75">
        {streak > 0 ? (
          <>
            <span className="font-semibold text-ink">
              {streak} day{streak === 1 ? "" : "s"} in a row.
            </span>{" "}
          </>
        ) : (
          "No streak running. "
        )}
        {week.total > 0
          ? `${week.total} answers in the last 7 days, ${Math.round((week.correct / week.total) * 100)}% right.`
          : "No practice in the last 7 days."}
      </p>
      <ol className="flex h-24 items-end gap-1" aria-label={`Answers per day, last ${DAYS} days`}>
        {days.map((day) => (
          <li key={day.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${day.date}: ${day.correct} of ${day.total} right`}>
            <div className="flex w-full flex-1 flex-col justify-end">
              {day.total > 0 ? (
                <div className="flex w-full flex-col overflow-hidden rounded-sm" style={{ height: `${Math.max(8, (day.total / peak) * 100)}%` }}>
                  <div className="bg-terracotta" style={{ flexGrow: day.total - day.correct }} />
                  <div className="bg-turquoise-dark" style={{ flexGrow: day.correct }} />
                </div>
              ) : (
                <div className="h-0.5 w-full rounded-sm bg-ink/15" />
              )}
            </div>
            <span className="text-[0.65rem] text-ink/45">{weekday(day.date)}</span>
          </li>
        ))}
      </ol>
      <p className="flex gap-4 text-xs text-ink/55">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-turquoise-dark" />
          right
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-terracotta" />
          wrong
        </span>
      </p>
    </div>
  );
}
