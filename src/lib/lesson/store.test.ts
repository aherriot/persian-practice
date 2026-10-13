// recordAnswer against a real Postgres (PGlite): the one statement that logs
// an answer and moves the schedule, and what it does when an answer arrives
// twice or two arrive together.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { closeTestDb, createTestDb, emptyTestDb, type TestDb } from "../db/test-db.ts";
import { knowledge, lexemes, reviewLog, sentences, users } from "../db/schema.ts";
import type { Submission } from "./check.ts";

let db: TestDb;
let recordAnswer: typeof import("./store.ts").recordAnswer;

before(async () => {
  db = await createTestDb();
  // Only now: store.ts imports the database, which must already be the test one.
  ({ recordAnswer } = await import("./store.ts"));
});

beforeEach(async () => {
  await emptyTestDb(db);
  await db.insert(users).values([{ id: ME, email: "me@example.com" }]);
  await db
    .insert(lexemes)
    .values(["apple", "pear", "plum"].map((id) => ({ id, fa: `fa-${id}`, voc: `voc-${id}`, translit: id, gloss: `gloss ${id}` })));
  await db.insert(sentences).values({
    id: FRUIT,
    themeId: null,
    position: 0,
    english: "apple pear plum",
    tokens: ["apple", "pear", "plum"].map((id) => ({ lexemeId: id, fa: `fa-${id}`, voc: `voc-${id}`, translit: id })),
    endPunct: ".",
    lexemeIds: ["apple", "pear", "plum"],
  });
  // Apple and pear are due; plum was answered an hour ago and is not.
  await know("apple", { dueInDays: -1 });
  await know("pear", { dueInDays: -1 });
  await know("plum", { dueInDays: 5 });
});
after(() => closeTestDb(db));

const ME = "learner-me";
const FRUIT = "fruit";
const NOW = new Date("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

async function know(refId: string, { dueInDays }: { dueInDays: number }) {
  await db.insert(knowledge).values({
    userId: ME,
    kind: "lexeme",
    refId,
    stability: 1,
    difficulty: 5,
    intervalDays: 1,
    repetitions: 1,
    dueAt: new Date(NOW.getTime() + dueInDays * DAY),
    lastReviewedAt: new Date(NOW.getTime() - DAY),
  });
}

async function state(refId: string) {
  const [row] = await db.select().from(knowledge).where(and(eq(knowledge.userId, ME), eq(knowledge.refId, refId)));
  return row;
}

const logged = () => db.select().from(reviewLog).where(eq(reviewLog.userId, ME));

const right: Submission = { sentenceId: FRUIT, exercise: "listen", primary: { kind: "lexeme", id: "apple" }, answer: "apple pear plum" };
const wrong: Submission = { ...right, answer: "something else" };

test("a right answer moves on everything in the sentence that was due, and nothing that was not", async () => {
  const plumBefore = await state("plum");
  assert.deepEqual(await recordAnswer(ME, right, "k1", NOW), { ok: true, correct: true, duplicate: false });

  for (const id of ["apple", "pear"]) {
    const row = await state(id);
    assert.equal(row.repetitions, 2, id);
    assert.ok(row.dueAt > NOW, id);
    assert.deepEqual(row.lastReviewedAt, NOW, id);
  }
  assert.deepEqual(await state("plum"), plumBefore);
});

test("an answer that arrives twice is logged once and moves the schedule once", async () => {
  await recordAnswer(ME, right, "k1", NOW);
  const after = await state("apple");

  const later = new Date(NOW.getTime() + 60_000);
  assert.deepEqual(await recordAnswer(ME, right, "k1", later), { ok: true, correct: true, duplicate: true });
  assert.deepEqual(await state("apple"), after);
  assert.equal((await logged()).length, 1);
});

test("a repeated key changes nothing even if the word has come due again", async () => {
  await recordAnswer(ME, right, "k1", NOW);
  // Much later the same answer turns up once more, from a browser that never heard back.
  const muchLater = new Date(NOW.getTime() + 30 * DAY);
  const before = await state("apple");
  assert.equal((await recordAnswer(ME, right, "k1", muchLater) as { duplicate: boolean }).duplicate, true);
  assert.deepEqual(await state("apple"), before);
});

test("two answers about the same word at the same moment are both logged, and the word moves on once", async () => {
  const results = await Promise.all([recordAnswer(ME, right, "k1", NOW), recordAnswer(ME, right, "k2", NOW)]);
  assert.deepEqual(results.map((r) => r.ok && r.duplicate), [false, false]);
  assert.equal((await logged()).length, 2);
  assert.equal((await state("apple")).repetitions, 2);
  assert.equal((await state("pear")).repetitions, 2);
});

test("a right and a wrong answer racing on one word leave it as whichever got there first left it", async () => {
  await Promise.all([recordAnswer(ME, wrong, "k1", NOW), recordAnswer(ME, right, "k2", NOW)]);
  const apple = await state("apple");
  assert.equal(apple.lapses, 1);
  assert.equal(apple.repetitions, 0);
  assert.equal((await logged()).length, 2);
});

test("a wrong answer sets back only the word the exercise was about", async () => {
  const [pearBefore, plumBefore] = [await state("pear"), await state("plum")];
  assert.deepEqual(await recordAnswer(ME, wrong, "k1", NOW), { ok: true, correct: false, duplicate: false });

  const apple = await state("apple");
  assert.equal(apple.lapses, 1);
  assert.equal(apple.repetitions, 0);
  assert.deepEqual(await state("pear"), pearBefore);
  assert.deepEqual(await state("plum"), plumBefore);
});

test("the log says what was being tested and, for a wrong answer, what was picked", async () => {
  await recordAnswer(ME, wrong, "k1", NOW);
  await recordAnswer(ME, { ...right, primary: { kind: "lexeme", id: "pear" } }, "k2", NOW);
  const rows = (await logged()).sort((a, b) => a.key!.localeCompare(b.key!));
  assert.deepEqual(
    rows.map((r) => [r.correct, r.target, r.picked]),
    [
      [false, "lexeme:apple", "something else"],
      [true, "lexeme:pear", null],
    ],
  );
});

test("an answer about a word the sentence does not use is refused, and nothing is stored", async () => {
  await db.insert(lexemes).values({ id: "fig", fa: "fa-fig", voc: "voc-fig", translit: "fig", gloss: "gloss fig" });
  const result = await recordAnswer(ME, { ...right, primary: { kind: "lexeme", id: "fig" } }, "k1", NOW);
  assert.equal(result.ok, false);
  assert.equal((await logged()).length, 0);
  assert.equal((await state("apple")).repetitions, 1);
});

test("ungraded practice is logged, and a right answer still moves on what was due", async () => {
  assert.deepEqual(await recordAnswer(ME, { ...right, primary: null }, "k1", NOW), { ok: true, correct: true, duplicate: false });
  assert.equal((await logged())[0].target, null);
  assert.equal((await state("apple")).repetitions, 2);

  // Wrong, with nothing in particular being tested: nobody is set back.
  await recordAnswer(ME, { ...wrong, primary: null }, "k2", new Date(NOW.getTime() + 60_000));
  assert.equal((await state("apple")).lapses, 0);
});
