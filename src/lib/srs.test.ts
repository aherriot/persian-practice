import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_EASE_FACTOR,
  MIN_EASE_FACTOR,
  NEW_ITEM_STATE,
  placementSeedState,
  qualityFromOutcome,
  reviewItem,
} from "./srs.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-01-01T00:00:00.000Z");

function closeTo(actual: number, expected: number, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be close to ${expected}`,
  );
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

test("qualityFromOutcome maps conversational outcomes to SM-2 quality", () => {
  assert.equal(qualityFromOutcome("correct"), 5);
  assert.equal(qualityFromOutcome("recast"), 2);
  assert.equal(qualityFromOutcome("unknown"), null);
});

test("three consecutive perfect reviews follow the classic SM-2 interval ladder", () => {
  let state = NEW_ITEM_STATE;
  let now = NOW;

  const r1 = reviewItem(state, 5, now);
  assert.equal(r1.repetitions, 1);
  assert.equal(r1.intervalDays, 1);
  closeTo(r1.easeFactor, 2.6); // +0.1 per SM-2 formula at quality 5
  assert.equal(daysBetween(now, r1.dueAt), 1);

  now = r1.dueAt;
  state = r1;
  const r2 = reviewItem(state, 5, now);
  assert.equal(r2.repetitions, 2);
  assert.equal(r2.intervalDays, 6);
  closeTo(r2.easeFactor, 2.7);

  now = r2.dueAt;
  state = r2;
  const r3 = reviewItem(state, 5, now);
  assert.equal(r3.repetitions, 3);
  assert.equal(r3.intervalDays, Math.round(6 * 2.7)); // 16
  closeTo(r3.easeFactor, 2.8);
});

test("quality 4 leaves ease factor unchanged", () => {
  const r = reviewItem(NEW_ITEM_STATE, 4, NOW);
  closeTo(r.easeFactor, DEFAULT_EASE_FACTOR);
  assert.equal(r.repetitions, 1);
  assert.equal(r.intervalDays, 1);
});

test("a recast (quality 2) resets repetitions and interval, but does not zero the ease factor", () => {
  const r = reviewItem(NEW_ITEM_STATE, 2, NOW);
  assert.equal(r.repetitions, 0);
  assert.equal(r.intervalDays, 1);
  assert.equal(r.lapses, 1);
  // 2.5 + (0.1 - 3*(0.08 + 3*0.02)) = 2.5 - 0.32 = 2.18
  closeTo(r.easeFactor, 2.18);
  assert.ok(r.easeFactor > MIN_EASE_FACTOR, "recast should not collapse ease to the floor");
});

test("ease factor is floored at MIN_EASE_FACTOR, never goes negative or below it", () => {
  let state = { intervalDays: 1, easeFactor: MIN_EASE_FACTOR + 0.01, repetitions: 2, lapses: 0 };
  // Repeated total blanks (quality 0) should still floor, not crash through it.
  for (let i = 0; i < 5; i++) {
    state = reviewItem(state, 0, NOW);
  }
  assert.equal(state.easeFactor, MIN_EASE_FACTOR);
});

test("a lapse after prior good reviews resets repetitions/interval but preserves accumulated ease above the floor", () => {
  const afterTwoGood = reviewItem(reviewItem(NEW_ITEM_STATE, 5, NOW), 5, NOW);
  assert.equal(afterTwoGood.repetitions, 2);
  assert.equal(afterTwoGood.intervalDays, 6);

  const lapsed = reviewItem(afterTwoGood, 2, NOW);
  assert.equal(lapsed.repetitions, 0);
  assert.equal(lapsed.intervalDays, 1);
  assert.equal(lapsed.lapses, 1);
  assert.ok(lapsed.easeFactor < afterTwoGood.easeFactor, "a lapse should reduce ease");
});

test("placementSeedState marks items as low-confidence, due tomorrow, unreviewed", () => {
  const seed = placementSeedState(NOW);
  assert.equal(seed.repetitions, 0);
  assert.equal(seed.lapses, 0);
  assert.equal(seed.intervalDays, 1);
  assert.equal(seed.easeFactor, DEFAULT_EASE_FACTOR);
  assert.equal(seed.lastReviewedAt, null);
  assert.equal(daysBetween(NOW, seed.dueAt), 1);
});

test("reviewItem always sets lastReviewedAt to the review time", () => {
  const r = reviewItem(NEW_ITEM_STATE, 5, NOW);
  assert.equal(r.lastReviewedAt?.getTime(), NOW.getTime());
});
