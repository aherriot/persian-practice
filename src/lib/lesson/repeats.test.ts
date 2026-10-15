// Keeping generated sentences from repeating what a learner has, against a
// real Postgres (PGlite). No model is called.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { closeTestDb, createTestDb, emptyTestDb, type TestDb } from "../db/test-db.ts";
import { sentences, users } from "../db/schema.ts";
import type { Candidate } from "./drafts.ts";

let db: TestDb;
let repeats: typeof import("./repeats.ts");

before(async () => {
  db = await createTestDb();
  // Only now: repeats.ts imports the database, which must already be the test one.
  repeats = await import("./repeats.ts");
});

beforeEach(async () => {
  await emptyTestDb(db);
  await db.insert(users).values([ME, OTHER].map((id) => ({ id, email: `${id}@example.com` })));
});
after(() => closeTestDb(db));

const ME = "learner-me";
const OTHER = "learner-other";

/** A sentence of the given words, each spelt as its id. */
const sentence = (english: string, words: string[], patternIds: string[] = []) => ({
  english,
  tokens: words.map((id) => ({ lexemeId: id, fa: id, voc: id, translit: id })),
  endPunct: ".",
  lexemeIds: [...new Set(words)],
  patternIds,
});

const practice = (english: string, words: string[], patternIds: string[] = []): Candidate => ({
  sentence: sentence(english, words, patternIds),
  teaches: null,
  word: null,
});

async function has(ownerId: string, english: string, words: string[], { patternIds = [] as string[], retired = false } = {}) {
  await db.insert(sentences).values({
    ...sentence(english, words, patternIds),
    id: `${ownerId}-${english}`,
    themeId: null,
    position: 0,
    generated: true,
    ladder: false,
    retired,
    ownerId,
  });
}

test("the same words in another order are a repeat; the same words in other grammar are not", async () => {
  await has(ME, "I want bread", ["nun", "mikham"]);
  const { candidates, rejected } = await repeats.dropRepeats(ME, [
    practice("Bread, I want", ["mikham", "nun"]),
    practice("Do I want bread?", ["mikham", "nun"], ["question"]),
  ]);
  assert.deepEqual(rejected.map((r) => r.reason), ["already exists"]);
  assert.deepEqual(candidates.map((c) => c.sentence.english), ["Do I want bread?"]);
});

test("a repeat of an earlier sentence in the same batch is dropped", async () => {
  const { candidates, rejected } = await repeats.dropRepeats(ME, [
    practice("I want tea", ["chai", "mikham"]),
    practice("Tea, I want", ["mikham", "chai"]),
  ]);
  assert.deepEqual(candidates.map((c) => c.sentence.english), ["I want tea"]);
  assert.equal(rejected.length, 1);
});

test("the reviewer is shown what the learner has a word away, and nothing further off", async () => {
  await has(ME, "I want bread", ["nun", "mikham"]);
  await has(ME, "I really want bread", ["kheyli", "nun", "mikham"]);
  await has(ME, "I want bread and tea", ["nun", "va", "chai", "mikham"]);
  await has(ME, "I want tea", ["chai", "mikham"]);
  await has(ME, "I really want bread now", ["kheyli", "nun", "alan", "mikham"], { retired: true });
  await has(OTHER, "Really, I want bread now", ["kheyli", "alan", "nun", "mikham"]);

  const { candidates } = await repeats.dropRepeats(ME, [practice("I really want bread now", ["kheyli", "nun", "alan", "mikham"])]);
  assert.deepEqual(candidates[0].similar, ["kheyli nun mikham. = I really want bread"]);
});

test("a sentence that teaches something new is not held up against what the learner has", async () => {
  await has(ME, "I want bread", ["nun", "mikham"]);
  const { candidates } = await repeats.dropRepeats(ME, [{ ...practice("I want cheese", ["panir", "mikham"]), teaches: "panir — cheese" }]);
  assert.deepEqual(candidates[0].similar, []);
});

test("words apart counts the words either sentence has that the other lacks", () => {
  assert.equal(repeats.wordDistance(["a", "b"], ["b", "a"]), 0);
  assert.equal(repeats.wordDistance(["a", "b"], ["a", "b", "c"]), 1);
  assert.equal(repeats.wordDistance(["a", "b"], ["a", "c"]), 2);
});
