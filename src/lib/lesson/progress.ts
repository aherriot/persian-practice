import { componentsOf } from "./plan";
import { targetKey, type KnowledgeState, type ThemeContent } from "./types";

/** Answered right this many times in a row, a word is past recognition and into building sentences. */
const MATURE_REPS = 3;

export type Progress = {
  /** Words and patterns met. */
  known: number;
  /** Of those, how many are well established. */
  mature: number;
  /** Words and patterns on the ladder that have not been met yet. */
  remaining: number;
};

export function measureProgress(content: ThemeContent, knowledge: Map<string, KnowledgeState>): Progress {
  const onLadder = new Set(content.sentences.filter((s) => s.ladder).flatMap((s) => componentsOf(s).map(targetKey)));
  const states = [...knowledge.entries()].filter(([key]) => onLadder.has(key)).map(([, state]) => state);
  return {
    known: states.length,
    mature: states.filter((state) => state.repetitions >= MATURE_REPS).length,
    remaining: onLadder.size - states.length,
  };
}

/** Most of what the learner knows is well established: time to make it harder. */
export const isFluent = (p: Progress, share: number) => p.known >= 8 && p.mature / p.known >= share;
