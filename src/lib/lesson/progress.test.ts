import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTheme } from "../content/build.ts";
import { SHOPPING } from "../content/shopping.ts";
import { componentsOf } from "./plan.ts";
import { isFluent, isReadyForMore, measureProgress } from "./progress.ts";
import { evenly, targetKey, type KnowledgeState } from "./types.ts";

const content = buildTheme(SHOPPING);
const state = (repetitions: number): KnowledgeState => evenly({ stability: 1, difficulty: 5, intervalDays: 1, repetitions, lapses: 0, dueAt: new Date(), lastReviewedAt: null });
const all = [...new Set(content.sentences.flatMap((s) => componentsOf(s).map(targetKey)))];
const onLadder = new Set(all);

test("progress counts what is met, what is solid, and what is left", () => {
  const knowledge = new Map(all.slice(0, 10).map((key, i) => [key, state(i < 4 ? 3 : 1)]));
  assert.deepEqual(measureProgress(onLadder, knowledge), { known: 10, secure: 10, mature: 4, remaining: all.length - 10 });
});

test("a learner is fluent in what they know once most of it is well established", () => {
  assert.equal(isFluent({ known: 10, secure: 10, mature: 4, remaining: 0 }, 0.5), false);
  assert.equal(isFluent({ known: 10, secure: 10, mature: 6, remaining: 0 }, 0.5), true);
  // Too little known to judge.
  assert.equal(isFluent({ known: 3, secure: 3, mature: 3, remaining: 0 }, 0.5), false);
});

test("new material does not wait for spaced repetition to mature what is known", () => {
  // Everything answered right once or twice, nothing yet at three: ready.
  assert.equal(isReadyForMore({ known: 34, secure: 32, mature: 0, remaining: 0 }, 3), true);
  // Mistakes slow it down, however much else is known.
  assert.equal(isReadyForMore({ known: 200, secure: 196, mature: 150, remaining: 0 }, 3), false);
});
