import assert from "node:assert/strict";
import { test } from "node:test";

import { DESIRED_RETENTION, MAX_INTERVAL_DAYS, NEW_ITEM_STATE, intervalFor, retrievability, reviewItem, type SrsState } from "./srs.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-01-01T00:00:00.000Z");
const later = (from: Date, days: number) => new Date(from.getTime() + days * DAY_MS);

function closeTo(actual: number, expected: number, epsilon = 1e-3) {
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be close to ${expected}`);
}

/** Answers right every time, each review on the day it falls due. */
function rightOnTime(state: SrsState, times: number, start = NOW) {
  let now = start;
  let current = reviewItem(state, "good", now);
  for (let i = 1; i < times; i++) {
    now = current.dueAt;
    current = reviewItem(current, "good", now);
  }
  return current;
}

test("stability is the number of days for recall to fall to the desired retention", () => {
  closeTo(retrievability(10, 10), DESIRED_RETENTION);
  assert.equal(intervalFor(10), 10);
  assert.equal(intervalFor(0.2), 1);
  assert.equal(intervalFor(5000), MAX_INTERVAL_DAYS);
});

test("a first right answer starts from the published FSRS-5 defaults, but comes back the next day", () => {
  const r = reviewItem(NEW_ITEM_STATE, "good", NOW);
  closeTo(r.stability, 3.173);
  closeTo(r.difficulty, 5.2824);
  assert.equal(r.intervalDays, 1);
  assert.equal(r.repetitions, 1);
  assert.equal(r.lapses, 0);
  assert.equal(r.dueAt.getTime(), later(NOW, 1).getTime());
  assert.equal(r.lastReviewedAt.getTime(), NOW.getTime());
});

test("a first wrong answer starts harder and comes back the next day", () => {
  const r = reviewItem(NEW_ITEM_STATE, "again", NOW);
  closeTo(r.stability, 0.40255);
  closeTo(r.difficulty, 7.1949);
  assert.equal(r.intervalDays, 1);
  assert.equal(r.repetitions, 0);
  assert.equal(r.lapses, 1);
});

const REFERENCE = {
  second: { stability: 5.86914185, difficulty: 5.27296793, intervalDays: 6 },
  third: { stability: 19.84586547, difficulty: 5.26354498, intervalDays: 20 },
  lapsed: { stability: 2.95931827, difficulty: 6.78423209 },
};

// What ts-fsrs 4.7.1 (FSRS-5, enable_short_term: false) gives for the same
// reviews at the same times: right on day 0, day 1, day 7, then wrong on day 27.
test("right answers on time match the reference implementation", () => {
  const second = rightOnTime(NEW_ITEM_STATE, 2);
  closeTo(second.stability, REFERENCE.second.stability);
  closeTo(second.difficulty, REFERENCE.second.difficulty);
  assert.equal(second.intervalDays, REFERENCE.second.intervalDays);
  const third = rightOnTime(NEW_ITEM_STATE, 3);
  closeTo(third.stability, REFERENCE.third.stability);
  closeTo(third.difficulty, REFERENCE.third.difficulty);
  assert.equal(third.intervalDays, REFERENCE.third.intervalDays);
  assert.equal(third.repetitions, 3);
});

test("a miss resets the run and comes back next day, but keeps part of what was learned", () => {
  const known = rightOnTime(NEW_ITEM_STATE, 3);
  const lapsed = reviewItem(known, "again", known.dueAt);
  assert.equal(lapsed.repetitions, 0);
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.intervalDays, 1);
  assert.ok(lapsed.stability < known.stability);
  assert.ok(lapsed.stability > 1, "more is left than of a word never known");
  closeTo(lapsed.stability, REFERENCE.lapsed.stability);
  closeTo(lapsed.difficulty, REFERENCE.lapsed.difficulty);
});

test("intervals keep growing with right answers and difficulty never rises", () => {
  let state = rightOnTime(NEW_ITEM_STATE, 1);
  for (let i = 0; i < 6; i++) {
    const next = reviewItem(state, "good", state.dueAt);
    assert.ok(next.intervalDays > state.intervalDays || next.intervalDays === MAX_INTERVAL_DAYS);
    assert.ok(next.difficulty <= state.difficulty, "a right answer never makes an item harder");
    state = next;
  }
});

test("a word missed once recovers, which the old ease factor never did", () => {
  const known = rightOnTime(NEW_ITEM_STATE, 3);
  const lapsed = reviewItem(known, "again", known.dueAt);
  const recovered = rightOnTime(lapsed, 3, lapsed.dueAt);
  assert.ok(recovered.intervalDays > known.intervalDays / 2, `${recovered.intervalDays} days after three right answers`);
});

test("repeated misses push difficulty towards its ceiling, never past it", () => {
  let state = reviewItem(NEW_ITEM_STATE, "again", NOW);
  for (let i = 0; i < 20; i++) state = reviewItem(state, "again", later(NOW, i + 1));
  assert.ok(state.difficulty <= 10);
  assert.ok(state.difficulty > 9);
  assert.ok(state.stability > 0);
  assert.equal(state.intervalDays, 1);
});

test("a right answer long overdue earns more than one given on time", () => {
  const known = rightOnTime(NEW_ITEM_STATE, 2);
  const onTime = reviewItem(known, "good", known.dueAt);
  const overdue = reviewItem(known, "good", later(known.dueAt, 30));
  assert.ok(overdue.stability > onTime.stability);
});

test("a state with no review time falls back on its scheduled interval", () => {
  const known = rightOnTime(NEW_ITEM_STATE, 2);
  const converted = { ...known, lastReviewedAt: null };
  closeTo(reviewItem(converted, "good", known.dueAt).stability, reviewItem(known, "good", known.dueAt).stability, 1e-6);
});
