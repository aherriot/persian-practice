import { NEW_ITEM_STATE, reviewItem, type Grade } from "@/lib/srs";
import { evenly, targetKey, type KnowledgeState, type SkillState, type Target } from "./types";

const HOUR = 60 * 60 * 1000;

/**
 * The scheduler works to the minute; a learner who practised at 9pm yesterday and
 * sits down at 8am today should still get yesterday's items. Pulling each due
 * time earlier by a few hours makes "tomorrow" mean the next sitting.
 */
const DUE_SLACK_MS = 8 * HOUR;

export function introducedSkill(now: Date): SkillState {
  return { ...NEW_ITEM_STATE, dueAt: now };
}

/** Something just met: new, and due, in every skill. */
export function introducedState(now: Date): KnowledgeState {
  return evenly(introducedSkill(now));
}

/**
 * New scheduling states after one graded exercise, keyed like the input map.
 * `states` are for the one skill the exercise tested; no other skill moves.
 *
 * Right: everything in the sentence that was due advances; things not yet due
 * are left alone, so meeting a word again early does not inflate its interval.
 * Wrong: only the exercise's primary target lapses — a wrong sentence does not
 * say which of its words was the problem.
 */
export function applyAnswer(
  states: Map<string, SkillState>,
  primary: Target | null,
  others: Target[],
  correct: boolean,
  now: Date,
): Map<string, SkillState> {
  const updates = new Map<string, SkillState>();
  const schedule = (key: string, state: SkillState, grade: Grade) => {
    const next = reviewItem(state, grade, now);
    updates.set(key, { ...next, dueAt: new Date(next.dueAt.getTime() - DUE_SLACK_MS) });
  };

  if (correct) {
    for (const target of primary ? [primary, ...others] : others) {
      const key = targetKey(target);
      const state = states.get(key);
      if (state && state.dueAt <= now) schedule(key, state, "good");
    }
  } else if (primary) {
    const key = targetKey(primary);
    const state = states.get(key);
    // Already lapsed and waiting: a second miss in the same sitting is not new information.
    const alreadyLapsed = state && state.repetitions === 0 && state.dueAt > now;
    if (state && !alreadyLapsed) schedule(key, state, "again");
  }
  return updates;
}
