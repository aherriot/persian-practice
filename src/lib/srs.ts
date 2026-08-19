/**
 * SM-2 spaced repetition, applied to per-user vocabulary/grammar items.
 *
 * There is no explicit 0-5 self-rating in natural conversation — the tutor's
 * structured output only tags a coarse conversational outcome per item. That
 * gets mapped down to a quality score before the standard SM-2 update runs.
 * `unknown` outcomes are deliberately excluded from scoring rather than
 * treated as a low grade: a noisy signal is worse than no signal (the same
 * stance `transcript.ts` takes toward garbled STT input).
 */

export type Quality = 0 | 1 | 2 | 3 | 4 | 5;

export type ConversationOutcome = "correct" | "recast" | "unknown";

export const DEFAULT_EASE_FACTOR = 2.5;
export const MIN_EASE_FACTOR = 1.3;

/**
 * `correct` — used unprompted and right.
 * `recast`  — wrong but recognizable; the tutor modeled the correct form. A
 *   lapse (resets repetitions), but not a total blank — quality 2, not 0.
 * `unknown` — the tutor couldn't confidently tag it. No SM-2 update at all.
 */
export function qualityFromOutcome(outcome: ConversationOutcome): Quality | null {
  switch (outcome) {
    case "correct":
      return 5;
    case "recast":
      return 2;
    case "unknown":
      return null;
  }
}

export type SrsState = {
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
};

export type SrsUpdate = SrsState & {
  dueAt: Date;
  /** Null for a placement-seeded item, which hasn't actually been reviewed yet. */
  lastReviewedAt: Date | null;
};

/** State for an item a user has never reviewed yet. */
export const NEW_ITEM_STATE: SrsState = {
  intervalDays: 0,
  easeFactor: DEFAULT_EASE_FACTOR,
  repetitions: 0,
  lapses: 0,
};

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Standard SM-2 update, unmodified. `now` is injectable for tests; defaults to
 * the real clock in production call sites.
 */
export function reviewItem(state: SrsState, quality: Quality, now: Date = new Date()): SrsUpdate {
  let { intervalDays, repetitions, lapses } = state;
  let { easeFactor } = state;

  if (quality < 3) {
    repetitions = 0;
    intervalDays = 1;
    lapses += 1;
  } else {
    repetitions += 1;
    intervalDays =
      repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(intervalDays * easeFactor);
  }

  easeFactor = Math.max(
    MIN_EASE_FACTOR,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  return {
    intervalDays,
    easeFactor,
    repetitions,
    lapses,
    dueAt: addDays(now, intervalDays),
    lastReviewedAt: now,
  };
}

/** Seed state for items granted on placement — "probably known," low confidence. */
export function placementSeedState(now: Date = new Date()): SrsUpdate {
  return {
    intervalDays: 1,
    easeFactor: DEFAULT_EASE_FACTOR,
    repetitions: 0,
    lapses: 0,
    dueAt: addDays(now, 1),
    lastReviewedAt: null,
  };
}
