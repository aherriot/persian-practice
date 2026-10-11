import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_EXCHANGES,
  MAX_TIER,
  gradeAnswer,
  nextStep,
  resultTier,
  startPlacement,
  tierToLevel,
  type PlacementBounds,
} from "./placement.ts";

test("startPlacement begins at the midpoint of the full tier range", () => {
  const bounds = startPlacement();
  assert.equal(bounds.lowTier, 1);
  assert.equal(bounds.highTier, MAX_TIER);
  assert.equal(bounds.currentTier, 4); // round((1+6)/2)
  assert.equal(bounds.exchangeCount, 0);
});

test("an always-correct learner converges to the top tier", () => {
  let bounds: PlacementBounds = startPlacement();
  let done = false;
  let iterations = 0;
  while (!done && iterations < 20) {
    const step = nextStep(bounds, true);
    bounds = step.bounds;
    done = step.done;
    iterations++;
  }
  assert.ok(done);
  assert.equal(resultTier(bounds), MAX_TIER);
  assert.ok(iterations <= MAX_EXCHANGES);
});

test("an always-wrong learner converges to tier 0 (below beginner)", () => {
  let bounds: PlacementBounds = startPlacement();
  let done = false;
  let iterations = 0;
  while (!done && iterations < 20) {
    const step = nextStep(bounds, false);
    bounds = step.bounds;
    done = step.done;
    iterations++;
  }
  assert.ok(done);
  assert.equal(resultTier(bounds), 0);
});

test("convergence is bounded by MAX_EXCHANGES even in pathological cases", () => {
  let bounds: PlacementBounds = startPlacement();
  let done = false;
  let iterations = 0;
  // Alternate right/wrong — worst case for a naive binary search.
  while (!done && iterations < 100) {
    const step = nextStep(bounds, iterations % 2 === 0);
    bounds = step.bounds;
    done = step.done;
    iterations++;
  }
  assert.ok(done);
  assert.ok(iterations <= MAX_EXCHANGES, `expected convergence within ${MAX_EXCHANGES}, took ${iterations}`);
});

test("a learner who passes tier 3 but fails tier 4 lands at tier 3", () => {
  let bounds: PlacementBounds = startPlacement(); // current = 4
  let step = nextStep(bounds, false); // fails tier 4 -> high = 3
  bounds = step.bounds;
  assert.equal(bounds.currentTier, 2); // round((1+3)/2)
  step = nextStep(bounds, true); // passes tier 2 -> low = 3
  bounds = step.bounds;
  assert.equal(bounds.currentTier, 3); // round((3+3)/2)
  step = nextStep(bounds, true); // passes tier 3 -> low = 4, high stays 3 -> done
  assert.ok(step.done);
  assert.equal(resultTier(step.bounds), 3);
});

test("tierToLevel maps the seeded tier range to level tags", () => {
  assert.equal(tierToLevel(0), "Pre-A1");
  assert.equal(tierToLevel(1), "A1");
  assert.equal(tierToLevel(3), "A2");
  assert.equal(tierToLevel(6), "B2");
});

test("gradeAnswer accepts an exact or partial match on gloss or transliteration", () => {
  assert.equal(gradeAnswer("hello", "hello", "salâm"), true);
  assert.equal(gradeAnswer("Hello!", "hello", "salâm"), true);
  assert.equal(gradeAnswer("salam", "hello", "salâm"), false); // no accent normalization, expected miss
  assert.equal(gradeAnswer("to go", "go", undefined), true);
  assert.equal(gradeAnswer("banana", "hello", "salâm"), false);
});

test("gradeAnswer rejects trivial short input rather than matching via includes", () => {
  assert.equal(gradeAnswer("a", "a book about cats", undefined), false);
  assert.equal(gradeAnswer("", "hello", undefined), false);
});
