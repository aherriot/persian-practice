import { applyAnswer } from "./grade";
import type { Skill, SkillState, Target } from "./types";

/**
 * How well a learner knows a word or grammar point in one skill, in words they
 * can follow: four levels read off FSRS stability, the number of days until
 * the chance of recalling it falls to 90% (src/lib/srs.ts). Right answers at
 * the scheduled times take a skill up one level each: about 3 days of memory
 * after the first, 6 after the second (the next day), 20 after the third (a
 * week on) and 60 after the fourth (a month in), which is mastered. A miss
 * drops it back.
 *
 * Shown after each answer, so the learner can see what an answer did, and why
 * a word they feel they know still comes back: one skill of it may lag.
 */

export const LEVELS = ["New", "Learning", "Familiar", "Strong", "Mastered"] as const;
export type Level = 0 | 1 | 2 | 3 | 4;
/** The stability, in days, from which each level after "Learning" starts. */
const FROM_DAYS = [5, 15, 45];

export const SKILL_NAME: Record<Skill, string> = { listening: "Hearing", reading: "Reading", producing: "Recalling" };

export function masteryOf(state: Pick<SkillState, "stability">): Level {
  if (state.stability <= 0) return 0;
  return (1 + FROM_DAYS.filter((days) => state.stability >= days).length) as Level;
}

/** A word or grammar point is as well known as its weakest skill. */
export const overallMastery = (skills: Record<Skill, Pick<SkillState, "stability">>): Level =>
  Math.min(...Object.values(skills).map(masteryOf)) as Level;

export type Change = {
  before: SkillState;
  after: SkillState;
  from: Level;
  to: Level;
  /** Answered right before it was due: the schedule did not move. */
  early: boolean;
};

/**
 * What one answer does to the one skill it tested, worked out the way the
 * server will (grade.ts), so it can be shown at once.
 */
export function changeFrom(before: SkillState, primary: Target, correct: boolean, now: Date): Change {
  const key = `${primary.kind}:${primary.id}`;
  const after = applyAnswer(new Map([[key, before]]), primary, [], correct, now).get(key) ?? before;
  return { before, after, from: masteryOf(before), to: masteryOf(after), early: correct && after === before };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "tomorrow", "in 6 days", "in 2 months". */
export function whenNext(dueAt: Date, now: Date): string {
  const days = Math.max(1, Math.round((dueAt.getTime() - now.getTime()) / DAY_MS));
  if (days === 1) return "tomorrow";
  if (days < 45) return `in ${days} days`;
  return `in ${Math.round(days / 30)} months`;
}

/** One line on what the answer did, e.g. "Reading: Learning → Familiar. Back in 6 days." */
export function describeChange(skill: Skill, change: Change, now: Date): string {
  const name = SKILL_NAME[skill];
  const next = whenNext(change.after.dueAt, now);
  if (change.early) {
    const due = whenNext(change.before.dueAt, now);
    return `Extra practice: ${name.toLowerCase()} is not due ${due === "tomorrow" ? "until tomorrow" : due.replace(/^in/, "for")}, so its schedule stays.`;
  }
  if (change.after === change.before) return `${name}: already set to come back ${next}.`;
  const level = change.from === change.to ? LEVELS[change.to] : `${LEVELS[change.from]} → ${LEVELS[change.to]}`;
  return `${name}: ${level}. Back ${next}.`;
}
