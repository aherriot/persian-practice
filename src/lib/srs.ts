/**
 * FSRS spaced repetition, applied to per-user words and grammar points.
 *
 * Each item carries a memory model rather than an ease multiplier: `stability`
 * is how many days it takes for the chance of recalling it to fall to 90%, and
 * `difficulty` (1–10) is how hard this item is for this learner. A review
 * moves both by how surprising the answer was — a right answer long after an
 * item fell due grows stability more than one given early.
 *
 * This is the long-term half of FSRS-5 with its published default weights. It
 * has no same-day learning steps: a session is planned up front, so the
 * shortest gap there can be is the next sitting.
 *
 * It replaced SM-2, whose ease factor could only fall under the two grades the
 * lessons give (right and wrong), so every word ever missed drifted towards
 * the shortest schedule and stayed there.
 */

/** A lesson answer is right or wrong; FSRS calls those Good and Again. */
export type Grade = "good" | "again";

const RATING: Record<Grade, number> = { again: 1, good: 3 };
const EASY = 4;

// FSRS-5 default weights (github.com/open-spaced-repetition). 0–3: first
// stability per rating. 4–7: difficulty. 8–10: stability after a right answer.
// 11–14: stability after a wrong one. 15–18 belong to the Hard and Easy
// ratings and to same-day reviews, none of which are used here.
const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605,
  2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];

const DECAY = -0.5;
const FACTOR = 19 / 81;
/** An item is scheduled for when the chance of recalling it has fallen to this. */
export const DESIRED_RETENTION = 0.9;
/** However well something is known, it comes round again within this many days. */
export const MAX_INTERVAL_DAYS = 365;
/** Something answered wrong comes back at the next sitting, whatever is left of its stability. */
const LAPSE_INTERVAL_DAYS = 1;
/**
 * So does a new item after its first right answer. That answer comes moments
 * after the item was shown, so it says little about memory; FSRS expects
 * same-day learning steps to have happened before its first interval, and
 * there are none here. The second right answer is the first real recall.
 */
const FIRST_INTERVAL_DAYS = 1;
const MIN_STABILITY = 0.01;
const DAY_MS = 24 * 60 * 60 * 1000;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

export type SrsState = {
  /** Days for recall to fall to 90%. Zero until the item has been answered once. */
  stability: number;
  /** 1 (easy) to 10 (hard). Zero until the item has been answered once. */
  difficulty: number;
  /** The gap chosen at the last review. */
  intervalDays: number;
  /** Right answers in a row. */
  repetitions: number;
  /** Wrong answers ever. */
  lapses: number;
  lastReviewedAt: Date | null;
};

export type SrsUpdate = SrsState & { dueAt: Date; lastReviewedAt: Date };

/** State for an item a user has met but never answered. */
export const NEW_ITEM_STATE: SrsState = {
  stability: 0,
  difficulty: 0,
  intervalDays: 0,
  repetitions: 0,
  lapses: 0,
  lastReviewedAt: null,
};

const initialDifficulty = (rating: number) => clamp(W[4] - Math.exp(W[5] * (rating - 1)) + 1, 1, 10);

/** The chance of recalling an item `elapsedDays` after its last review. */
export function retrievability(stability: number, elapsedDays: number): number {
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

/** Days until recall falls to the desired retention. */
export function intervalFor(stability: number): number {
  const days = (stability / FACTOR) * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(days), 1, MAX_INTERVAL_DAYS);
}

function nextDifficulty(difficulty: number, rating: number): number {
  const delta = -W[6] * (rating - 3);
  // The nearer the ceiling, the less a miss adds; then a slight pull back towards an easy item's start.
  const damped = difficulty + (delta * (10 - difficulty)) / 9;
  return clamp(W[7] * initialDifficulty(EASY) + (1 - W[7]) * damped, 1, 10);
}

function stabilityAfterRecall(difficulty: number, stability: number, recall: number): number {
  const growth = Math.exp(W[8]) * (11 - difficulty) * Math.pow(stability, -W[9]) * (Math.exp((1 - recall) * W[10]) - 1);
  return clamp(stability * (1 + growth), MIN_STABILITY, 36500);
}

function stabilityAfterLapse(difficulty: number, stability: number, recall: number): number {
  const relearned = W[11] * Math.pow(difficulty, -W[12]) * (Math.pow(stability + 1, W[13]) - 1) * Math.exp((1 - recall) * W[14]);
  // Forgetting something never leaves it better known than before.
  return clamp(Math.min(relearned, stability), MIN_STABILITY, 36500);
}

/**
 * An item the learner showed they knew already, the moment they met it: what
 * FSRS gives a first answer rated Easy. About two weeks to the next review.
 */
export function alreadyKnown(now: Date): SrsUpdate {
  const stability = W[EASY - 1];
  const intervalDays = intervalFor(stability);
  return {
    stability,
    difficulty: initialDifficulty(EASY),
    intervalDays,
    repetitions: 1,
    lapses: 0,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS),
    lastReviewedAt: now,
  };
}

/** One review. `now` is injectable for tests; defaults to the real clock in production call sites. */
export function reviewItem(state: SrsState, grade: Grade, now: Date = new Date()): SrsUpdate {
  const rating = RATING[grade];
  let stability: number;
  let difficulty: number;
  const first = state.stability <= 0 || state.difficulty <= 0;

  if (first) {
    stability = W[rating - 1];
    difficulty = initialDifficulty(rating);
  } else {
    const elapsedDays = state.lastReviewedAt ? Math.max(0, (now.getTime() - state.lastReviewedAt.getTime()) / DAY_MS) : state.intervalDays;
    const recall = retrievability(state.stability, elapsedDays);
    stability =
      grade === "good"
        ? stabilityAfterRecall(state.difficulty, state.stability, recall)
        : stabilityAfterLapse(state.difficulty, state.stability, recall);
    difficulty = nextDifficulty(state.difficulty, rating);
  }

  const intervalDays = grade === "again" ? LAPSE_INTERVAL_DAYS : first ? FIRST_INTERVAL_DAYS : intervalFor(stability);
  return {
    stability,
    difficulty,
    intervalDays,
    repetitions: grade === "good" ? state.repetitions + 1 : 0,
    lapses: state.lapses + (grade === "good" ? 0 : 1),
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS),
    lastReviewedAt: now,
  };
}
