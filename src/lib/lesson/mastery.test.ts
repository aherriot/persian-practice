import assert from "node:assert/strict";
import { test } from "node:test";
import { NEW_ITEM_STATE } from "../srs.ts";
import { changeFrom, describeChange, masteryOf, overallMastery } from "./mastery.ts";
import type { SkillState } from "./types.ts";

const NOW = new Date("2026-10-14T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const WORD = { kind: "lexeme" as const, id: "ghahve" };
const fresh: SkillState = { ...NEW_ITEM_STATE, dueAt: NOW };

test("right answers at the scheduled times take a skill up a level each, to mastered by the fourth", () => {
  let state = fresh;
  let now = NOW;
  const levels = [];
  for (let i = 0; i < 4; i++) {
    state = changeFrom(state, WORD, true, now).after;
    levels.push(masteryOf(state));
    now = new Date(state.dueAt.getTime() + DAY / 2);
  }
  assert.deepEqual(levels, [1, 2, 3, 4]);
});

test("a miss drops a skill back", () => {
  const strong: SkillState = { ...fresh, stability: 20, difficulty: 5, intervalDays: 20, repetitions: 3, lastReviewedAt: new Date(NOW.getTime() - 20 * DAY) };
  const change = changeFrom(strong, WORD, false, NOW);
  assert.equal(change.from, 3);
  assert.ok(change.to < 3);
  assert.match(describeChange("reading", change, NOW), /^Reading: Strong → (Learning|Familiar)\. Back tomorrow\.$/);
});

test("a right answer before it is due is extra practice, and says so", () => {
  const waiting: SkillState = { ...fresh, stability: 6, difficulty: 5, intervalDays: 6, repetitions: 2, dueAt: new Date(NOW.getTime() + 4 * DAY), lastReviewedAt: NOW };
  const change = changeFrom(waiting, WORD, true, NOW);
  assert.equal(change.early, true);
  assert.equal(change.after, waiting);
  assert.equal(describeChange("listening", change, NOW), "Extra practice: hearing is not due for 4 days, so its schedule stays.");
});

test("a word is as well known as its weakest skill", () => {
  assert.equal(overallMastery({ listening: { stability: 60 }, reading: { stability: 20 }, producing: { stability: 3 } }), 1);
  assert.equal(overallMastery({ listening: { stability: 0 }, reading: { stability: 20 }, producing: { stability: 3 } }), 0);
});
