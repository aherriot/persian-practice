import type { KnowledgeState, Lexeme } from "./types";

/**
 * One wrong answer, counted: asked about `targetId`, the learner picked
 * something that is `pickedId`'s meaning ("word" exercises) or spelling
 * ("cloze"). `picked` is the text they picked. Several words can share a
 * meaning, so one pick may come back as several rows (see loadConfusions).
 */
export type ConfusionRow = {
  targetId: string;
  pickedId: string;
  picked: string;
  exercise: string;
  times: number;
};

export type Confusion = {
  /** The word that was asked about. */
  target: Lexeme;
  /** The word whose meaning or spelling was picked instead. */
  picked: Lexeme;
  times: number;
};

/**
 * What the learner mixes up with what, the most frequent first.
 *
 * Where a picked meaning belongs to several words, it is taken to be the one
 * the learner has met, since that is the one they can have had in mind. The
 * two kinds of exercise are added together: picking "carrot" for سیب and
 * picking هویج for the gap where سیب goes are the same mix-up.
 */
export function summariseConfusions(
  rows: ConfusionRow[],
  lexemes: Map<string, Lexeme>,
  knowledge: Map<string, KnowledgeState>,
): Confusion[] {
  // One pick, one word: the candidates for each (word asked, exercise, text picked).
  const picks = new Map<string, ConfusionRow[]>();
  for (const row of rows) {
    if (!lexemes.has(row.targetId) || !lexemes.has(row.pickedId) || row.targetId === row.pickedId) continue;
    const key = JSON.stringify([row.targetId, row.exercise, row.picked]);
    picks.set(key, [...(picks.get(key) ?? []), row]);
  }
  const met = (row: ConfusionRow) => (knowledge.has(`lexeme:${row.pickedId}`) ? 0 : 1);

  const pairs = new Map<string, Confusion>();
  for (const candidates of picks.values()) {
    const row = [...candidates].sort((a, b) => met(a) - met(b) || a.pickedId.localeCompare(b.pickedId))[0];
    const key = JSON.stringify([row.targetId, row.pickedId]);
    const pair = pairs.get(key) ?? { target: lexemes.get(row.targetId)!, picked: lexemes.get(row.pickedId)!, times: 0 };
    pairs.set(key, { ...pair, times: pair.times + row.times });
  }
  return [...pairs.values()].sort(
    (a, b) => b.times - a.times || a.target.id.localeCompare(b.target.id) || a.picked.id.localeCompare(b.picked.id),
  );
}

/**
 * For each word, the words it has been mixed up with, either way round and
 * the most often first: if هویج was picked for سیب, each makes a telling wrong
 * answer when the other is asked about.
 */
export function confusedWith(confusions: Confusion[]): Map<string, string[]> {
  const partners = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = partners.get(from) ?? [];
    if (!list.includes(to)) partners.set(from, [...list, to]);
  };
  for (const { target, picked } of confusions) {
    add(target.id, picked.id);
    add(picked.id, target.id);
  }
  return partners;
}
