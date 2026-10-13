import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAnswer, introducedState } from "./grade.ts";
import { evenly, type KnowledgeState, type Target } from "./types.ts";

const NOW = new Date("2026-10-11T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const sib: Target = { kind: "lexeme", id: "sib" };
const darim: Target = { kind: "lexeme", id: "darim" };
const negation: Target = { kind: "pattern", id: "negation" };

const known = (dueInDays: number, repetitions = 2): KnowledgeState => evenly({
  stability: 6,
  difficulty: 5,
  intervalDays: 6,
  repetitions,
  lapses: 0,
  dueAt: new Date(NOW.getTime() + dueInDays * DAY),
  lastReviewedAt: new Date(NOW.getTime() + (dueInDays - 6) * DAY),
});

test("a new word is due the moment it is introduced", () => {
  const state = introducedState(NOW);
  assert.equal(state.dueAt.getTime(), NOW.getTime());
  assert.equal(state.repetitions, 0);
  assert.equal(state.stability, 0);
});

test("a right answer advances everything in the sentence that was due, and nothing that was not", () => {
  const states = new Map([
    ["lexeme:sib", known(-1)],
    ["lexeme:darim", known(3)],
    ["pattern:negation", known(0)],
  ]);
  const updates = applyAnswer(states, sib, [darim, negation], true, NOW);
  assert.deepEqual([...updates.keys()].sort(), ["lexeme:sib", "pattern:negation"]);
  const next = updates.get("lexeme:sib")!;
  assert.equal(next.repetitions, 3);
  assert.ok(next.intervalDays > 6);
  assert.equal(next.lastReviewedAt?.getTime(), NOW.getTime());
});

test("the next due time is pulled a few hours early, so tomorrow means the next sitting", () => {
  const first = applyAnswer(new Map([["lexeme:sib", introducedState(NOW)]]), sib, [], true, NOW).get("lexeme:sib")!;
  assert.equal(first.dueAt.getTime(), NOW.getTime() + first.intervalDays * DAY - 8 * HOUR);
});

test("a wrong answer lapses only the primary target, and brings it back at the next sitting", () => {
  const states = new Map([
    ["lexeme:sib", known(-1)],
    ["lexeme:darim", known(-1)],
  ]);
  const updates = applyAnswer(states, sib, [darim], false, NOW);
  assert.deepEqual([...updates.keys()], ["lexeme:sib"]);
  const lapsed = updates.get("lexeme:sib")!;
  assert.equal(lapsed.repetitions, 0);
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.dueAt.getTime(), NOW.getTime() + DAY - 8 * HOUR);
});

test("a wrong answer lapses its target even when it was not yet due", () => {
  const updates = applyAnswer(new Map([["lexeme:sib", known(3)]]), sib, [], false, NOW);
  assert.equal(updates.get("lexeme:sib")?.lapses, 1);
});

test("a second miss in the same sitting is not new information", () => {
  const states = new Map([["lexeme:sib", known(-1)]]);
  const lapsed = applyAnswer(states, sib, [], false, NOW).get("lexeme:sib")!;
  const again = applyAnswer(new Map([["lexeme:sib", lapsed]]), sib, [], false, new Date(NOW.getTime() + 60_000));
  assert.equal(again.size, 0);
});

test("ungraded practice never lapses anything, and unmet words are ignored", () => {
  assert.equal(applyAnswer(new Map([["lexeme:sib", known(-1)]]), null, [sib], false, NOW).size, 0);
  assert.equal(applyAnswer(new Map(), sib, [darim], true, NOW).size, 0);
});
