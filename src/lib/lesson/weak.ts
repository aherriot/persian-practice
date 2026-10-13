import { VOWEL_FADE_REPS } from "./plan";
import type { KnowledgeState } from "./types";

/**
 * What counts as a weak word or grammar point. This is the one definition:
 * the progress page's "struggling" list, the dashboard's count and the
 * weak-words session all read it from here.
 *
 * Something is weak if the learner has got it wrong at least once and one of
 * these is still true:
 *
 *   missed      it was wrong the last time it came up
 *   recovering  it has been right since, but not yet three times running —
 *               the same bar at which a word counts as established
 *   hard        it is established again, but the scheduler still rates it
 *               hard (difficulty 8 or more out of 10, which takes about three
 *               misses) and has not yet let it out to three-week gaps
 *
 * Nothing that has never been missed is weak, however new, and a hard word
 * stops being weak once it has held up over a gap of three weeks.
 *
 * It is read from the scheduling state alone, not from the answer log, so
 * it costs no query beyond the one that loads what the learner knows.
 */
export type Weakness = "missed" | "recovering" | "hard";

/** FSRS difficulty (1–10) from which an established item still counts as weak. */
export const HARD_DIFFICULTY = 8;
/** …until the gap between its reviews has grown to this many days. */
export const SETTLED_INTERVAL_DAYS = 21;
/** How many weak things one session takes on, the weakest first. */
export const WEAK_SESSION = 10;

export function weaknessOf(state: Pick<KnowledgeState, "repetitions" | "lapses" | "difficulty" | "intervalDays">): Weakness | null {
  if (state.lapses === 0) return null;
  if (state.repetitions === 0) return "missed";
  if (state.repetitions < VOWEL_FADE_REPS) return "recovering";
  return state.difficulty >= HARD_DIFFICULTY && state.intervalDays < SETTLED_INTERVAL_DAYS ? "hard" : null;
}

const ORDER: Weakness[] = ["missed", "recovering", "hard"];

/** Sorts the weakest first: by kind of weakness, then the harder, then the more often missed. */
export function byWeakness<T extends Pick<KnowledgeState, "lapses" | "difficulty"> & { weakness: Weakness }>(a: T, b: T): number {
  return ORDER.indexOf(a.weakness) - ORDER.indexOf(b.weakness) || b.difficulty - a.difficulty || b.lapses - a.lapses;
}

/** Target keys ("lexeme:…", "pattern:…") of everything weak, the weakest first. */
export function weakTargets(knowledge: Map<string, KnowledgeState>): string[] {
  return [...knowledge]
    .flatMap(([key, state]) => {
      const weakness = weaknessOf(state);
      return weakness ? [{ key, weakness, lapses: state.lapses, difficulty: state.difficulty }] : [];
    })
    .sort((a, b) => byWeakness(a, b) || a.key.localeCompare(b.key))
    .map((item) => item.key);
}
