// The steps a preparation job goes through, with the slow work (authors,
// reviewer, audio) replaced by stand-ins that record what they were asked.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Job } from "../jobs/queue.ts";
import type { Candidate, Draft } from "./drafts.ts";
import { isSlow, prepareStep, type PrepareState, type Stages } from "./prepare.ts";

const candidate = (english: string): Candidate => ({
  sentence: { english, tokens: [], endPunct: ".", lexemeIds: [], patternIds: [] },
  teaches: null,
  word: null,
});
const drafted = (...english: string[]): Draft => ({ candidates: english.map(candidate), rejected: [] });
const english = (state: PrepareState | null) => state?.batch?.candidates.map((c) => c.sentence.english);

function job(kind: Job["kind"], state: PrepareState | null = null, payload: Record<string, unknown> = {}): Job {
  return { id: "job", userId: "me", kind, key: "key", payload, state, status: "pending", attempts: 0 } as Job;
}

function stand(overrides: Partial<Stages> = {}) {
  const calls: string[] = [];
  const stages: Stages = {
    draftFrontier: async () => (calls.push("draftFrontier"), drafted("new word")),
    storeFrontier: async (_user, c) => calls.push(`storeFrontier ${c.sentence.english}`),
    draftPractice: async (_user, opts) => (calls.push(`draftPractice ${JSON.stringify(opts)}`), drafted("one", "two", "three")),
    storePractice: async (_user, c) => calls.push(`storePractice ${c.sentence.english}`),
    review: async (candidates) => (calls.push("review"), { kept: candidates }),
    makeWordClip: async (_user, lexemeId) => calls.push(`makeWordClip ${lexemeId}`),
    draftLessons: async (_user, lexemeId) => (calls.push(`draftLessons ${lexemeId}`), drafted("lesson one", "lesson two")),
    storeLesson: async (_user, c) => calls.push(`storeLesson ${c.sentence.english}`),
    ...overrides,
  };
  return { stages, calls };
}

/** Runs a job to the end, returning every state it passed through. */
async function runToEnd(start: Job, stages: Stages): Promise<(PrepareState | null)[]> {
  const states: (PrepareState | null)[] = [];
  for (let current = start; ; ) {
    const next = await prepareStep(current, stages);
    states.push(next);
    if (!next) return states;
    current = { ...current, state: next };
  }
}

test("a session job expands the course, then writes practice sentences, one stored per step", async () => {
  const { stages, calls } = stand();
  const states = await runToEnd(job("session"), stages);
  assert.deepEqual(calls, [
    "draftFrontier",
    "review",
    "storeFrontier new word",
    "draftPractice {}",
    "review",
    "storePractice one",
    "storePractice two",
    "storePractice three",
  ]);
  assert.equal(states.length, calls.length);
  assert.equal(states.at(-1), null);
});

test("reviewed sentences wait in the job's state until each has been stored", async () => {
  const { stages } = stand();
  const reviewed: PrepareState = { phase: "sentences", batch: { candidates: ["one", "two", "three"].map(candidate), reviewed: true } };
  const next = await prepareStep(job("session", reviewed), stages);
  assert.deepEqual(english(next), ["two", "three"]);
  assert.equal(next?.batch?.reviewed, true);
});

test("a store that throws leaves the state as it was, so the same sentence is tried again", async () => {
  const { stages } = stand({
    storePractice: async () => {
      throw new Error("speech service down");
    },
  });
  const reviewed: PrepareState = { phase: "sentences", batch: { candidates: ["one", "two"].map(candidate), reviewed: true } };
  await assert.rejects(prepareStep(job("session", reviewed), stages), /speech service down/);
  assert.deepEqual(english(reviewed), ["one", "two"]);
});

test("only what the reviewer keeps goes on to be stored", async () => {
  const { stages, calls } = stand({ review: async (candidates) => ({ kept: candidates.slice(1, 2) }) });
  await runToEnd(job("session", { phase: "sentences", batch: null }), stages);
  assert.deepEqual(calls, ['draftPractice {}', "storePractice two"]);
});

test("a phase with nothing to write is passed over", async () => {
  const { stages, calls } = stand({
    draftFrontier: async () => ({ skipped: "12 things still to learn", candidates: [], rejected: [] }),
    review: async () => ({ kept: [] }),
  });
  const states = await runToEnd(job("session"), stages);
  assert.deepEqual(calls, ["draftPractice {}"]);
  assert.deepEqual(states, [{ phase: "sentences", batch: null }, { phase: "sentences", batch: { candidates: ["one", "two", "three"].map(candidate), reviewed: false } }, null]);
});

test("a word job makes the word's audio, then lessons around that word", async () => {
  const { stages, calls } = stand();
  await runToEnd(job("word", null, { lexemeId: "own-apple" }), stages);
  assert.deepEqual(calls, ["makeWordClip own-apple", "draftLessons own-apple", "review", "storeLesson lesson one", "storeLesson lesson two"]);
});

test("drafting and reviewing are the slow steps; audio for one sentence or word is not", () => {
  assert.equal(isSlow(job("session")), true);
  assert.equal(isSlow(job("session", { phase: "expand", batch: { candidates: [candidate("a")], reviewed: false } })), true);
  assert.equal(isSlow(job("session", { phase: "expand", batch: { candidates: [candidate("a")], reviewed: true } })), false);
  assert.equal(isSlow(job("session", { phase: "sentences", batch: null })), true);
  assert.equal(isSlow(job("word")), false);
});
