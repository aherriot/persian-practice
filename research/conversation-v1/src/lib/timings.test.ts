import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LATENCY_GOOD_MS,
  LATENCY_USABLE_MS,
  createTurnTimer,
  formatMs,
  verdictFor,
} from "./timings.ts";

/** Deterministic clock so span maths can be checked exactly. */
function fakeClock(sequence: number[]) {
  let i = 0;
  return () => sequence[Math.min(i++, sequence.length - 1)];
}

test("summarises a full turn into spans and a headline total", () => {
  const timer = createTurnTimer(fakeClock([0, 120, 700, 1500, 2100, 2200]));
  timer.mark("speechEnd");
  timer.mark("uploaded");
  timer.mark("transcribed");
  timer.mark("replied");
  timer.mark("audioReady");
  timer.mark("playbackStart");

  const summary = timer.summary();
  assert.ok(summary);
  assert.equal(summary.totalMs, 2200);
  assert.equal(summary.verdict, "usable");

  assert.deepEqual(
    summary.spans.map((s) => [s.label, s.ms]),
    [
      ["upload", 120],
      ["speech-to-text", 580],
      ["language model", 800],
      ["text-to-speech", 600],
      ["playback start", 100],
    ],
  );

  // The spans must account for the whole headline number, or the breakdown is
  // lying about where the time went.
  assert.equal(
    summary.spans.reduce((total, s) => total + s.ms, 0),
    summary.totalMs,
  );
});

test("returns null until the turn actually completes", () => {
  const timer = createTurnTimer(fakeClock([0, 100, 200]));
  assert.equal(timer.summary(), null, "nothing marked");
  timer.mark("speechEnd");
  assert.equal(timer.summary(), null, "no playback yet");
  timer.mark("transcribed");
  assert.equal(timer.summary(), null, "still no playback");
});

test("a repeated mark does not shorten the measured span", () => {
  // A retry or a React re-render firing the same stage twice must not make the
  // turn look faster than it was.
  const timer = createTurnTimer(fakeClock([0, 500, 900]));
  timer.mark("speechEnd");
  timer.mark("speechEnd");
  timer.mark("playbackStart");

  assert.equal(timer.at("speechEnd"), 0);
  assert.equal(timer.summary()?.totalMs, 500);
});

test("skips spans whose endpoints were never marked", () => {
  // A partial turn — say TTS failed — must report the stages it does know
  // rather than inventing spans across the gap.
  const timer = createTurnTimer(fakeClock([0, 400, 900, 1200]));
  timer.mark("speechEnd");
  timer.mark("uploaded");
  timer.mark("transcribed");
  timer.mark("playbackStart");

  const summary = timer.summary();
  assert.deepEqual(
    summary?.spans.map((s) => [s.label, s.ms]),
    [
      ["upload", 400],
      ["speech-to-text", 500],
    ],
    "only fully-bounded spans appear",
  );
  // The headline still spans the whole turn even though the breakdown has holes.
  assert.equal(summary?.totalMs, 1200);
});

test("verdict thresholds match the ones committed before measuring", () => {
  assert.equal(verdictFor(0), "good");
  assert.equal(verdictFor(LATENCY_GOOD_MS - 1), "good");
  assert.equal(verdictFor(LATENCY_GOOD_MS), "usable", "1.5s is not 'feels conversational'");
  assert.equal(verdictFor(LATENCY_USABLE_MS), "usable");
  assert.equal(verdictFor(LATENCY_USABLE_MS + 1), "poor");
});

test("formatMs switches units at one second", () => {
  assert.equal(formatMs(0), "0ms");
  assert.equal(formatMs(999), "999ms");
  assert.equal(formatMs(1000), "1.00s");
  assert.equal(formatMs(2345), "2.35s");
});
