import { NEW_ITEM_STATE, reviewItem } from "@/lib/srs";
import { targetKey, type KnowledgeState, type Target } from "./types";

const HOUR = 60 * 60 * 1000;

/**
 * SM-2 schedules to the minute; a learner who practised at 9pm yesterday and
 * sits down at 8am today should still get yesterday's items. Pulling each due
 * time earlier by a few hours makes "tomorrow" mean the next sitting.
 */
const DUE_SLACK_MS = 8 * HOUR;

export function introducedState(now: Date): KnowledgeState {
  return { ...NEW_ITEM_STATE, dueAt: now };
}

/**
 * New SM-2 states after one graded exercise, keyed like the input map.
 *
 * Right: everything in the sentence that was due advances; things not yet due
 * are left alone, so meeting a word again early does not inflate its interval.
 * Wrong: only the exercise's primary target lapses — a wrong sentence does not
 * say which of its words was the problem.
 */
export function applyAnswer(
  states: Map<string, KnowledgeState>,
  primary: Target | null,
  others: Target[],
  correct: boolean,
  now: Date,
): Map<string, KnowledgeState> {
  const updates = new Map<string, KnowledgeState>();
  const schedule = (key: string, state: KnowledgeState, quality: 2 | 4) => {
    const next = reviewItem(state, quality, now);
    updates.set(key, {
      intervalDays: next.intervalDays,
      easeFactor: next.easeFactor,
      repetitions: next.repetitions,
      lapses: next.lapses,
      dueAt: new Date(next.dueAt.getTime() - DUE_SLACK_MS),
    });
  };

  if (correct) {
    for (const target of primary ? [primary, ...others] : others) {
      const key = targetKey(target);
      const state = states.get(key);
      if (state && state.dueAt <= now) schedule(key, state, 4);
    }
  } else if (primary) {
    const key = targetKey(primary);
    const state = states.get(key);
    // Already lapsed and waiting: a second miss in the same sitting is not new information.
    const alreadyLapsed = state && state.repetitions === 0 && state.dueAt > now;
    if (state && !alreadyLapsed) schedule(key, state, 2);
  }
  return updates;
}
