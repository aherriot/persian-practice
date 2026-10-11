/**
 * Adaptive binary-search placement — converges on a starting tier in a bounded
 * number of exchanges instead of making every new user start at zero.
 *
 * Exercises are graded as a plain recall check (show the Persian item, learner
 * types the English meaning), not a full LLM roleplay — that infrastructure
 * belongs to the conversation engine (M3) and placement shouldn't duplicate it
 * ahead of time.
 */

export const MIN_TIER = 1;
export const MAX_TIER = 6; // matches the seeded item bank's tier range
export const MAX_EXCHANGES = 8;

export type PlacementBounds = {
  lowTier: number;
  highTier: number;
  currentTier: number;
  exchangeCount: number;
};

function midpoint(low: number, high: number): number {
  return Math.round((low + high) / 2);
}

export function startPlacement(): PlacementBounds {
  return {
    lowTier: MIN_TIER,
    highTier: MAX_TIER,
    currentTier: midpoint(MIN_TIER, MAX_TIER),
    exchangeCount: 0,
  };
}

export type PlacementStep = {
  bounds: PlacementBounds;
  done: boolean;
};

/** One binary-search step: narrow the range based on whether the answer was correct. */
export function nextStep(bounds: PlacementBounds, correct: boolean): PlacementStep {
  const exchangeCount = bounds.exchangeCount + 1;
  const lowTier = correct ? bounds.currentTier + 1 : bounds.lowTier;
  const highTier = correct ? bounds.highTier : bounds.currentTier - 1;

  const done = highTier < lowTier || exchangeCount >= MAX_EXCHANGES;
  const currentTier = done ? bounds.currentTier : midpoint(lowTier, highTier);

  return { bounds: { lowTier, highTier, currentTier, exchangeCount }, done };
}

/** Highest tier confirmed correct. 0 means "below tier 1" — a true beginner. */
export function resultTier(bounds: PlacementBounds): number {
  return Math.max(0, Math.min(bounds.lowTier - 1, MAX_TIER));
}

const TIER_LEVELS: Record<number, string> = {
  0: "Pre-A1",
  1: "A1",
  2: "A1",
  3: "A2",
  4: "A2",
  5: "B1",
  6: "B2",
};

export function tierToLevel(tier: number): string {
  return TIER_LEVELS[tier] ?? "A1";
}

/**
 * Loose recall-check grading: case/diacritic-insensitive, and correct if either
 * answer contains the target or vice versa (covers "go" vs "to go", articles,
 * minor phrasing). Not meant to be rigorous — a wrong "correct" here just means
 * an easy tier gets confirmed a little too generously, which self-corrects
 * within a few exchanges either way.
 */
export function gradeAnswer(userAnswer: string, gloss: string, transliteration?: string | null): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[.,!?'"()]/g, "")
      .replace(/\s+/g, " ");

  const answer = normalize(userAnswer);
  // Guards against a trivial one-letter answer matching everything via `includes`.
  if (answer.length < 2) return false;

  const targets = [gloss, transliteration].filter((t): t is string => Boolean(t)).map(normalize);
  return targets.some((t) => t.includes(answer) || answer.includes(t));
}
