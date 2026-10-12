import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTheme } from "../content/build.ts";
import { SHOPPING } from "../content/shopping.ts";
import { dailyActivity } from "./activity.ts";
import { stageOf, summariseJourney } from "./journey.ts";
import type { KnowledgeState } from "./types.ts";

const content = buildTheme(SHOPPING);
const now = new Date(2026, 9, 12, 15);
const DAY = 24 * 60 * 60 * 1000;
const state = (repetitions: number, lapses = 0, dueInDays = 0, intervalDays = 1): KnowledgeState => ({
  intervalDays,
  easeFactor: 2.5,
  repetitions,
  lapses,
  dueAt: new Date(now.getTime() + dueInDays * DAY),
});

test("a stage says how the last answers went, not how many there were", () => {
  assert.equal(stageOf(state(0)), "new");
  assert.equal(stageOf(state(0, 2)), "shaky");
  assert.equal(stageOf(state(2, 2)), "learning");
  assert.equal(stageOf(state(3, 2)), "established");
});

test("the journey counts what is met and puts the shakiest struggles first", () => {
  const knowledge = new Map([
    ["lexeme:havij", state(3, 0, 5, 12)],
    ["lexeme:sib", state(4, 1, 20, 30)],
    ["lexeme:nun", state(1, 1, 0.5)],
    ["lexeme:darim", state(0, 3, -1)],
    ["lexeme:daram", state(0, 1, -1)],
    ["lexeme:ma", state(0, 0, -1)],
    ["pattern:" + [...content.patterns.keys()][0], state(1, 0, 3)],
    ["lexeme:removed-since", state(0, 5, -1)],
  ]);
  const journey = summariseJourney(content, knowledge, now);
  assert.equal(journey.words, 6);
  assert.equal(journey.patterns, 1);
  assert.deepEqual(journey.stages, { new: 1, shaky: 2, learning: 2, established: 2 });
  // Missed and not yet secure, worst first; sib was missed once but has since been established.
  assert.deepEqual(journey.struggling.map((item) => item.label), ["dârim", "dâram", "nun"]);
  assert.deepEqual(journey.strongest.map((item) => item.label), ["sib", "havij"]);
  assert.deepEqual(journey.due, { now: 3, day: 4, week: 6 });
});

test("a streak survives until a whole day is missed", () => {
  const at = (daysAgo: number, hour = 10) => new Date(2026, 9, 12 - daysAgo, hour).getTime();
  const hours = [
    { at: at(1), total: 10, correct: 8 },
    { at: at(1, 20), total: 5, correct: 5 },
    { at: at(2), total: 4, correct: 4 },
    { at: at(4), total: 9, correct: 9 },
  ];
  // Nothing yet today: yesterday and the day before still make a streak of two.
  const before = dailyActivity(hours, now, 3);
  assert.equal(before.streak, 2);
  assert.deepEqual(before.days.map((day) => [day.total, day.correct]), [[4, 4], [15, 13], [0, 0]]);
  assert.equal(dailyActivity([...hours, { at: at(0), total: 1, correct: 1 }], now, 3).streak, 3);
  assert.equal(dailyActivity([hours[3]], now, 3).streak, 0);
});
