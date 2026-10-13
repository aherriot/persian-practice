import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTheme } from "../content/build.ts";
import { SHOPPING } from "../content/shopping.ts";
import { applyAnswer } from "./grade.ts";
import { componentsOf, planSession } from "./plan.ts";
import { evenly, targetKey, type KnowledgeState, type SkillState } from "./types.ts";
import { weakTargets, weaknessOf } from "./weak.ts";

const content = buildTheme(SHOPPING);
const NOW = new Date("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const state = (over: Partial<SkillState> = {}): KnowledgeState => evenly({
  intervalDays: 1,
  stability: 1,
  difficulty: 5,
  repetitions: 0,
  lapses: 0,
  dueAt: new Date(NOW.getTime() + 3 * DAY),
  lastReviewedAt: new Date(NOW.getTime() - DAY),
  ...over,
});

test("only something that has been got wrong can be weak", () => {
  assert.equal(weaknessOf(state()), null); // just met
  assert.equal(weaknessOf(state({ repetitions: 2 })), null);
  assert.equal(weaknessOf(state({ repetitions: 9, difficulty: 9.5 })), null);
});

test("a missed word stays weak until it has been right three times running", () => {
  assert.equal(weaknessOf(state({ lapses: 1 })), "missed");
  assert.equal(weaknessOf(state({ lapses: 1, repetitions: 1 })), "recovering");
  assert.equal(weaknessOf(state({ lapses: 1, repetitions: 2 })), "recovering");
  assert.equal(weaknessOf(state({ lapses: 1, repetitions: 3 })), null);
});

test("a word the scheduler rates hard stays weak until it holds over three weeks", () => {
  assert.equal(weaknessOf(state({ lapses: 3, repetitions: 3, difficulty: 8.4, intervalDays: 9 })), "hard");
  assert.equal(weaknessOf(state({ lapses: 3, repetitions: 5, difficulty: 8.4, intervalDays: 30 })), null);
  assert.equal(weaknessOf(state({ lapses: 3, repetitions: 3, difficulty: 7, intervalDays: 9 })), null);
});

test("the weakest come first: missed, then recovering, then hard; harder and more often missed before less", () => {
  const knowledge = new Map([
    ["lexeme:fine", state({ repetitions: 4 })],
    ["lexeme:hard", state({ lapses: 4, repetitions: 3, difficulty: 9 })],
    ["lexeme:recovering", state({ lapses: 1, repetitions: 1 })],
    ["lexeme:missed-once", state({ lapses: 1, difficulty: 6 })],
    ["lexeme:missed-often", state({ lapses: 3, difficulty: 8 })],
    ["pattern:missed", state({ lapses: 3, difficulty: 8 })],
  ]);
  assert.deepEqual(weakTargets(knowledge), [
    "lexeme:missed-often",
    "pattern:missed",
    "lexeme:missed-once",
    "lexeme:recovering",
    "lexeme:hard",
  ]);
});

/** Everything the first `n` ladder sentences use, known well and not due. */
function knowing(n: number) {
  const map = new Map<string, KnowledgeState>();
  for (const s of content.sentences.slice(0, n)) {
    for (const c of componentsOf(s)) map.set(targetKey(c), state({ repetitions: 4 }));
  }
  return map;
}

test("a session can be about chosen things that are not due, in the order asked for", () => {
  const knowledge = knowing(8);
  knowledge.set("lexeme:darim", state({ lapses: 2 }));
  knowledge.set("lexeme:havij", state({ lapses: 1, repetitions: 1 }));

  // Nothing is due, so an ordinary session reviews nothing.
  assert.equal(planSession(content, knowledge, { now: NOW, seed: 1, maxNew: 0 }).reviewCount, 0);

  const plan = planSession(content, knowledge, { now: NOW, seed: 1, maxNew: 0, review: weakTargets(knowledge) });
  assert.equal(plan.newCount, 0);
  assert.equal(plan.reviewCount, 2);
  const graded = plan.exercises.flatMap((e) => ((e.type === "choice" || e.type === "tiles") && e.primary ? [e.primary.id] : []));
  assert.deepEqual(graded, ["darim", "havij"]);
  assert.ok(plan.exercises.every((e) => e.type !== "intro-lexeme" && e.type !== "intro-pattern"));
});

test("things asked for that the learner has not met are left out, and the session is capped", () => {
  const knowledge = knowing(8);
  const all = [...knowledge.keys()];
  const plan = planSession(content, knowledge, { now: NOW, seed: 1, maxNew: 0, maxReview: 3, review: ["lexeme:never-met", ...all] });
  assert.equal(plan.reviewCount, 3);
});

test("practising a weak word early does not move it on, but getting it wrong still counts", () => {
  const waiting = state({ lapses: 1, repetitions: 1, dueAt: new Date(NOW.getTime() + 2 * DAY) });
  const states = new Map([["lexeme:darim", waiting]]);
  const target = { kind: "lexeme" as const, id: "darim" };

  // Right, before it is due: no change, so cramming cannot push it out of sight.
  assert.equal(applyAnswer(states, target, [], true, NOW).size, 0);

  // Wrong, at any time: it lapses.
  const missed = applyAnswer(states, target, [], false, NOW).get("lexeme:darim")!;
  assert.equal(missed.repetitions, 0);
  assert.equal(missed.lapses, 2);

  // Right once it is due: it moves on as in any session.
  const due = new Map([["lexeme:darim", { ...waiting, dueAt: NOW }]]);
  assert.equal(applyAnswer(due, target, [], true, NOW).get("lexeme:darim")!.repetitions, 2);
});
