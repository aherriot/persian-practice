import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTheme } from "../content/build.ts";
import { SHOPPING } from "../content/shopping.ts";
import { aheadBy, newPerSession, stretchFrom } from "./pace.ts";
import { componentsOf, planSession } from "./plan.ts";
import { evenly, targetKey, type KnowledgeState, type SkillState } from "./types.ts";
import { weakTargets } from "./weak.ts";

const content = buildTheme(SHOPPING);
const NOW = new Date("2026-10-14T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const answers = (right: number, wrong: number) => [...Array(right).fill(true), ...Array(wrong).fill(false)];

const known = (over: Partial<SkillState> = {}): KnowledgeState =>
  evenly({ intervalDays: 6, stability: 6, difficulty: 5, repetitions: 4, lapses: 0, dueAt: new Date(NOW.getTime() + 3 * DAY), lastReviewedAt: new Date(NOW.getTime() - DAY), ...over });
/** Everything the first `n` ladder sentences use, known well and not due. */
function knowing(n: number) {
  const map = new Map<string, KnowledgeState>();
  for (const s of content.sentences.slice(0, n)) for (const c of componentsOf(s)) map.set(targetKey(c), known());
  return map;
}

test("the stretch is nothing at 85% right or below, and full from 95%", () => {
  assert.equal(stretchFrom(answers(17, 3)), 0);
  assert.ok(Math.abs(stretchFrom(answers(18, 2)) - 0.5) < 1e-9);
  assert.equal(stretchFrom(answers(57, 3)), 1);
  assert.equal(stretchFrom(answers(10, 0)), 0, "too few answers to go on");
});

test("a learner getting nearly everything right is brought twice as much that is new, asked harder", () => {
  assert.deepEqual([newPerSession(0), newPerSession(0.5), newPerSession(1)], [3, 5, 6]);
  assert.deepEqual([aheadBy(0), aheadBy(1)], [0, 2]);
  const easy = planSession(content, new Map(), { now: NOW, seed: 1 });
  const fast = planSession(content, new Map(), { now: NOW, seed: 1, stretch: 1 });
  assert.equal(easy.newCount, 3);
  assert.equal(fast.newCount, 6);
  // Recognising a word just shown is skipped.
  assert.ok(easy.exercises.some((e) => e.type === "choice" && e.variant === "read-word"));
  assert.ok(!fast.exercises.some((e) => e.type === "choice" && e.variant === "read-word"));
});

test("weak things that are not due wait while there is something new to teach", () => {
  const knowledge = knowing(4);
  const [first] = knowledge.keys();
  knowledge.set(first, known({ lapses: 1, repetitions: 0 }));
  const weak = weakTargets(knowledge);
  assert.deepEqual(weak, [first]);
  const id = first.slice(first.indexOf(":") + 1);
  const primaries = (plan: ReturnType<typeof planSession>) =>
    plan.exercises.flatMap((e) => ((e.type === "choice" || e.type === "tiles") && e.primary ? [e.primary.id] : []));

  // Something new to teach: the weak word is left for when it is due.
  const teaching = planSession(content, knowledge, { now: NOW, seed: 1, weak });
  assert.ok(teaching.newCount > 0);
  assert.ok(!primaries(teaching).includes(id));

  // Nothing new: it fills the session.
  const nothingNew = planSession(content, knowledge, { now: NOW, seed: 1, weak, maxNew: 0 });
  assert.ok(primaries(nothingNew).includes(id));
});
