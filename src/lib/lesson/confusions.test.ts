import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTheme } from "../content/build.ts";
import { SHOPPING } from "../content/shopping.ts";
import { confusedWith, summariseConfusions, type ConfusionRow } from "./confusions.ts";
import { componentsOf, planSession } from "./plan.ts";
import { evenly, targetKey, type KnowledgeState, type Lexeme } from "./types.ts";

const content = buildTheme(SHOPPING);
const NOW = new Date("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const word = (id: string, gloss = id): Lexeme => ({
  id,
  fa: `fa-${id}`,
  voc: `voc-${id}`,
  translit: id,
  gloss,
  lemma: null,
  literary: null,
  note: null,
  subjectPronoun: null,
  verbPerson: null,
  ownerId: null,
  addedBy: null,
});
const words = (...list: Lexeme[]) => new Map(list.map((l) => [l.id, l]));
const row = (targetId: string, pickedId: string, times: number, exercise = "word", picked = pickedId): ConfusionRow => ({
  targetId,
  pickedId,
  picked,
  exercise,
  times,
});
const state = (repetitions: number, dueInDays: number): KnowledgeState => evenly({
  intervalDays: 1,
  stability: 1,
  difficulty: 5,
  repetitions,
  lapses: 0,
  dueAt: new Date(NOW.getTime() + dueInDays * DAY),
  lastReviewedAt: null,
});
const show = (confusions: ReturnType<typeof summariseConfusions>) => confusions.map((c) => `${c.picked.id} for ${c.target.id} x${c.times}`);

test("mix-ups are counted per pair across both kinds of exercise, the most frequent first", () => {
  const lexemes = words(word("apple"), word("pear"), word("plum"));
  const confusions = summariseConfusions(
    [row("apple", "pear", 2), row("apple", "pear", 1, "cloze", "fa-pear"), row("apple", "plum", 4), row("pear", "apple", 1)],
    lexemes,
    new Map(),
  );
  assert.deepEqual(show(confusions), ["plum for apple x4", "pear for apple x3", "apple for pear x1"]);
});

test("a meaning two words share is taken to be the one the learner has met, and counted once", () => {
  const lexemes = words(word("apple"), word("pear-a", "pear"), word("pear-b", "pear"));
  const rows = [row("apple", "pear-a", 3, "word", "pear"), row("apple", "pear-b", 3, "word", "pear")];
  assert.deepEqual(show(summariseConfusions(rows, lexemes, new Map([["lexeme:pear-b", state(1, 1)]]))), ["pear-b for apple x3"]);
  assert.deepEqual(show(summariseConfusions(rows, lexemes, new Map())), ["pear-a for apple x3"]);
});

test("words no longer in the course are dropped", () => {
  assert.deepEqual(summariseConfusions([row("apple", "gone", 5), row("gone", "apple", 5)], words(word("apple")), new Map()), []);
});

test("a mix-up counts both ways round when choosing wrong answers", () => {
  const lexemes = words(word("apple"), word("pear"), word("plum"));
  const partners = confusedWith(summariseConfusions([row("apple", "plum", 4), row("apple", "pear", 2), row("pear", "apple", 1)], lexemes, new Map()));
  assert.deepEqual(partners.get("apple"), ["plum", "pear"]);
  assert.deepEqual(partners.get("pear"), ["apple"]);
  assert.deepEqual(partners.get("plum"), ["apple"]);
});

test("a word the learner has mixed up with another is offered as a wrong answer for it", () => {
  // Everything in the theme is known and just met, so words come up as word and missing-word questions.
  const knowledge = new Map<string, KnowledgeState>();
  for (const s of content.sentences) for (const c of componentsOf(s)) knowledge.set(targetKey(c), state(0, -1));
  const [first, second] = [...content.lexemes.values()].filter((l) => l.gloss !== undefined);
  const confusions = new Map(
    [...content.lexemes.keys()].map((id) => [id, [id === first.id ? second.id : first.id]] as [string, string[]]),
  );

  let checked = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const plan = planSession(content, knowledge, { now: NOW, seed, maxNew: 0, maxReview: 20, confusions });
    for (const e of plan.exercises) {
      if (e.type !== "choice" || (e.variant !== "read-word" && e.variant !== "cloze") || !e.primary) continue;
      const target = content.lexemes.get(e.primary.id)!;
      const partner = content.lexemes.get(confusions.get(target.id)![0])!;
      const [right, wrong] = e.variant === "read-word" ? [target.gloss, partner.gloss] : [e.sentence.tokens[e.tokenIndex!].fa, partner.fa];
      // Unless it would be a second right answer.
      if (right === wrong) continue;
      assert.ok(e.options.includes(wrong), `${e.variant} for ${target.id} offers ${partner.id}`);
      assert.equal(e.options[e.answer], right);
      checked++;
    }
  }
  assert.ok(checked > 20, `checked ${checked} exercises`);
});

test("with no mix-ups on record a plan is what it was", () => {
  const knowledge = new Map<string, KnowledgeState>();
  for (const s of content.sentences.slice(0, 10)) for (const c of componentsOf(s)) knowledge.set(targetKey(c), state(1, -1));
  const opts = { now: NOW, seed: 7 };
  assert.deepEqual(planSession(content, knowledge, { ...opts, confusions: new Map() }), planSession(content, knowledge, opts));
});
