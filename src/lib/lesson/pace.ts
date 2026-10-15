/**
 * How hard to push a learner, from how they have been doing. The aim is to
 * keep them getting about TARGET of what they are asked right: much more and
 * they are being asked what they already know, which is dull and teaches
 * little; much less and they are being buried.
 *
 * "Stretch" goes from 0, the course as written for a beginner, to 1, as fast
 * and as hard as it goes. It is read off the learner's recent graded answers:
 * 0 at TARGET or below, rising to 1 at FULL. Pushing harder brings their
 * accuracy down and so the stretch with it, and the two settle where the
 * learner is getting about TARGET to FULL right.
 *
 * It sets:
 * - how much new material a session brings in (plan.ts, `newPerSession`),
 * - how soon exercises move on from recognising to producing (plan.ts),
 * - that a session with room teaches something new rather than going over
 *   what is not due yet (plan.ts),
 * - how early and how much new material is written (expand.ts).
 */

/** The recent graded answers read. */
export const PACE_WINDOW = 60;
/** Below this many, too little is known about the learner: no stretch. */
export const PACE_MIN_ANSWERS = 20;
/** Share right at and below which there is no stretch… */
export const TARGET = 0.85;
/** …and from which it is full. */
export const FULL = 0.95;

export function stretchFrom(correct: boolean[]): number {
  if (correct.length < PACE_MIN_ANSWERS) return 0;
  const share = correct.filter(Boolean).length / correct.length;
  return Math.min(1, Math.max(0, (share - TARGET) / (FULL - TARGET)));
}

/** New words and grammar points a session may bring in, from the course's 3 up to 6. */
export const newPerSession = (stretch: number, base = 3) => base + Math.round(stretch * base);

/**
 * How far ahead of a skill's own record its exercises are pitched: a learner
 * at full stretch is asked as though they had answered right twice more.
 */
export const aheadBy = (stretch: number) => Math.round(stretch * 2);
