// The limits on how much is written for a learner, against a real Postgres
// (PGlite). The author is a stand-in: no model is called and no audio made.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { closeTestDb, createTestDb, emptyTestDb, type TestDb } from "../db/test-db.ts";
import { knowledge, lexemes, sentences, users } from "../db/schema.ts";
import type { SentenceDraft } from "./assemble.ts";
import type { AuthorRequest } from "./author.ts";

let db: TestDb;
let generate: typeof import("./generate.ts");

before(async () => {
  // The model client is built when its module loads and refuses to be without a key.
  process.env.OPENAI_API_KEY ??= "not-used";
  db = await createTestDb();
  // Only now: generate.ts imports the database, which must already be the test one.
  generate = await import("./generate.ts");
});

beforeEach(async () => {
  await emptyTestDb(db);
  await db.insert(users).values([ME, OTHER].map((id) => ({ id, email: `${id}@example.com` })));
  await db.insert(lexemes).values(WORDS.map((id) => ({ id, fa: `fa-${id}`, voc: `voc-${id}`, translit: id, gloss: `gloss ${id}` })));
  await db.insert(knowledge).values(
    [ME, OTHER].flatMap((userId) => WORDS.map((refId) => ({ userId, kind: "lexeme" as const, refId, repetitions: 1, dueAt: new Date() }))),
  );
});
after(() => closeTestDb(db));

const ME = "learner-me";
const OTHER = "learner-other";
const WORDS = ["apple", "pear", "plum", "fig", "tea", "milk"];
const HOUR = 60 * 60 * 1000;

/** Sentences already written by the app, `hoursAgo` hours ago. */
async function written(ownerId: string, count: number, { ladder = false, hoursAgo = 1, tag = "" } = {}) {
  if (count === 0) return;
  await db.insert(sentences).values(
    Array.from({ length: count }, (_, i) => ({
      id: `written-${ownerId}-${ladder}-${hoursAgo}-${tag}${i}`,
      themeId: null,
      position: 0,
      english: `written ${i}`,
      tokens: [],
      endPunct: ".",
      lexemeIds: ["apple"],
      generated: true,
      ladder,
      ownerId,
      createdAt: new Date(Date.now() - hoursAgo * HOUR),
    })),
  );
}

/** An author that writes as many two-word sentences as it likes, and records what it was asked. */
function author(writes: number) {
  const requests: AuthorRequest[] = [];
  const pairs = WORDS.flatMap((a) => WORDS.filter((b) => b !== a).map((b) => [a, b]));
  const write = async (request: AuthorRequest): Promise<SentenceDraft[]> => {
    requests.push(request);
    return pairs.slice(0, writes).map(([a, b]) => ({
      english: `${a} ${b}`,
      kind: "statement",
      tokens: [
        { word: a, form: "base", comma: false },
        { word: b, form: "base", comma: false },
      ],
    }));
  };
  return { write, requests };
}

test("a learner starts the day with their whole allowance", async () => {
  assert.equal(await generate.practiceAllowance(ME), generate.LEARNER_DAILY_CAP);
});

test("what was written for one learner does not use up another's allowance", async () => {
  await written(OTHER, generate.LEARNER_DAILY_CAP);
  assert.equal(await generate.practiceAllowance(OTHER), 0);
  assert.equal(await generate.practiceAllowance(ME), generate.LEARNER_DAILY_CAP);
});

test("only the last day counts, and only practice sentences count against the learner", async () => {
  await written(ME, 10, { hoursAgo: 25 });
  await written(ME, 5, { ladder: true });
  await written(ME, 3);
  assert.equal(await generate.practiceAllowance(ME), generate.LEARNER_DAILY_CAP - 3);
});

test("a learner at their limit gets nothing written, and the author is never asked", async () => {
  await written(ME, generate.LEARNER_DAILY_CAP);
  const { write, requests } = author(8);
  const draft = await generate.draftPractice(ME, { force: true }, write);
  assert.equal(draft.skipped, "daily limit reached");
  assert.deepEqual(draft.candidates, []);
  assert.equal(requests.length, 0);
});

test("near the limit the author is asked only for what is left, and no more than that is kept", async () => {
  await written(ME, generate.LEARNER_DAILY_CAP - 2);
  const { write, requests } = author(8);
  const draft = await generate.draftPractice(ME, { force: true }, write);
  assert.equal(requests[0].count, 2);
  assert.equal(draft.candidates.length, 2);
});

test("the ceiling for everyone stops a learner who has allowance of their own", async () => {
  // Spread over more learners than any one limit allows, as it would be.
  const crowd = Array.from({ length: generate.GLOBAL_DAILY_CAP / generate.LEARNER_DAILY_CAP }, (_, i) => `learner-${i}`);
  await db.insert(users).values(crowd.map((id) => ({ id, email: `${id}@example.com` })));
  for (const id of crowd) await written(id, generate.LEARNER_DAILY_CAP);

  assert.equal(await generate.practiceAllowance(ME), 0);
  const { write, requests } = author(8);
  assert.equal((await generate.draftPractice(ME, { force: true }, write)).skipped, "daily limit reached");
  assert.equal(requests.length, 0);
});

test("sentences added to the ladder count towards the ceiling for everyone", async () => {
  await written(OTHER, 30, { ladder: true });
  assert.equal(await generate.generatedToday(), 30);
});

test("storing a sentence whose audio passes uses up one of the day's allowance; one whose audio fails does not", async () => {
  const { write } = author(2);
  const { candidates } = await generate.draftPractice(ME, { force: true }, write);

  const kept = await generate.storePractice(ME, candidates[0], async () => true);
  assert.ok("added" in kept);
  const dropped = await generate.storePractice(ME, candidates[1], async () => false);
  assert.ok("rejected" in dropped);
  assert.equal(await generate.practiceAllowance(ME), generate.LEARNER_DAILY_CAP - 1);

  // Stored once however often the step is repeated after being cut off.
  await generate.storePractice(ME, candidates[0], async () => true);
  assert.equal(await generate.practiceAllowance(ME), generate.LEARNER_DAILY_CAP - 1);
});
