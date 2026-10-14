"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { dailyActivity, type ActivityHour } from "@/lib/lesson/activity";
import { actionClass } from "./styles";

const noop = () => () => {};

/**
 * What the dashboard leads with: the streak, whether today is done, what is
 * due, and the one thing to do about it: practise. A session reviews what the
 * learner keeps getting wrong first, then whatever else is due, then teaches
 * something new, so there is one button for all of it.
 *
 * The streak and "today" are worked out in the browser, as on the progress
 * page: a day is the learner's own, and the server does not know their time
 * zone. What is due does not depend on the day, so the server has already
 * counted it and the action is there before the streak is.
 *
 * `historyDays` is how far back `hours` goes; a streak that long may be longer.
 */
export function Today({
  hours,
  historyDays,
  due,
  weak,
  met,
}: {
  hours: ActivityHour[];
  historyDays: number;
  due: number;
  /** Things the learner keeps getting wrong; practice starts with these. */
  weak: number;
  met: number;
}) {
  // Nothing on the server or during hydration, so the two cannot disagree about what day it is.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const { days, streak } = dailyActivity(hours, mounted ? new Date() : new Date(0), 1);
  const done = mounted && days[0].total > 0;
  const capped = streak >= historyDays - 1;

  return (
    <section
      aria-label="Today"
      className="flex flex-col gap-4 rounded-lg border border-ink/15 bg-sand px-5 py-5 shadow-[inset_0_4px_8px_-6px_rgba(42,29,22,0.35)]"
    >
      <div className="flex items-center gap-4">
        <p
          className={`min-w-14 text-center font-[family-name:var(--font-display-latin)] text-5xl font-bold leading-none ${
            mounted && streak > 0 ? "text-cobalt" : "text-ink/25"
          }`}
          aria-hidden={!mounted}
        >
          {mounted ? `${streak}${capped ? "+" : ""}` : "–"}
        </p>
        <div className="flex min-h-11 flex-col justify-center" aria-live="polite">
          {mounted && (
            <>
              <p className="text-sm font-semibold text-ink">
                {streak === 0 ? "No streak running" : `day${streak === 1 && !capped ? "" : "s"} in a row`}
              </p>
              <p className={`text-sm ${done ? "text-turquoise-dark" : "text-ink/65"}`}>
                {done
                  ? "Today is done."
                  : streak > 0
                    ? "Not yet today: practise to keep it going."
                    : met === 0
                      ? "Your first session starts one."
                      : "A session today starts one."}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-ink/10 pt-4">
        <p className="text-sm text-ink/75">
          {met === 0 ? (
            "Nothing learned yet. Your first session starts at the beginning."
          ) : due > 0 || weak > 0 ? (
            <>
              {due > 0 && (
                <>
                  <span className="font-semibold text-ink">{due}</span> to review
                </>
              )}
              {due > 0 && weak > 0 && ", "}
              {weak > 0 && (
                <>
                  <span className="font-semibold text-ink">{weak}</span> you have been getting wrong
                </>
              )}
              . A session starts with those, then teaches something new.
            </>
          ) : (
            "Nothing to review. A session teaches something new."
          )}
        </p>
        <Link href="/practice" className={`shrink-0 ${actionClass}`}>
          {met === 0 ? "Start" : "Practise"}
        </Link>
      </div>
    </section>
  );
}
