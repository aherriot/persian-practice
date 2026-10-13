// The queries behind the dashboard and progress page, run against a real
// Postgres (PGlite) with the project's migrations applied.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { closeTestDb, createTestDb, emptyTestDb, type TestDb } from "../db/test-db.ts";
import { lexemes, reviewLog, users } from "../db/schema.ts";
import { dailyActivity } from "./activity.ts";

let db: TestDb;
let history: typeof import("./history.ts");

before(async () => {
  db = await createTestDb();
  history = await import("./history.ts");
});
beforeEach(() => emptyTestDb(db));
after(() => closeTestDb(db));

const NOW = new Date("2026-10-11T12:30:00Z");
const HOUR = 60 * 60 * 1000;
const ME = "learner-me";
const OTHER = "learner-other";

async function addUsers(...ids: string[]) {
  await db.insert(users).values(ids.map((id) => ({ id, email: `${id}@example.com` })));
}

async function answer(userId: string, hoursAgo: number, correct = true) {
  await db.insert(reviewLog).values({ userId, exercise: "listen", correct, createdAt: new Date(NOW.getTime() - hoursAgo * HOUR) });
}

test("activity is added up by the hour, for one learner, within the history kept", async () => {
  await addUsers(ME, OTHER);
  await answer(ME, 0.1);
  await answer(ME, 0.2, false);
  await answer(ME, 26);
  await answer(ME, 24 * 90); // older than the history
  await answer(OTHER, 0.1);

  const hours = (await history.loadActivityHours(ME, NOW)).sort((a, b) => b.at - a.at);
  assert.deepEqual(hours, [
    { at: Date.parse("2026-10-11T12:00:00Z"), total: 2, correct: 1 },
    { at: Date.parse("2026-10-10T10:00:00Z"), total: 1, correct: 1 },
  ]);
  // Which is what the browser needs to say "two days in a row, today done".
  const { days, streak } = dailyActivity(hours, NOW, 1);
  assert.equal(streak, 2);
  assert.equal(days[0].total, 2);
});

test("a learner who has never answered has no activity", async () => {
  await addUsers(ME);
  assert.deepEqual(await history.loadActivityHours(ME, NOW), []);
});

// --- Mix-ups ---

async function addWords(ids: string[], ownerId: string | null = null) {
  await db
    .insert(lexemes)
    .values(ids.map((id) => ({ id, fa: `fa-${id}`, voc: `voc-${id}`, translit: id, gloss: `gloss ${id}`, ownerId })));
}

type Miss = { userId?: string; target: string | null; picked: string | null; exercise?: string; correct?: boolean; daysAgo?: number };

async function miss({ userId = ME, target, picked, exercise = "word", correct = false, daysAgo = 1 }: Miss) {
  await db.insert(reviewLog).values({ userId, exercise, correct, target, picked, createdAt: new Date(NOW.getTime() - daysAgo * 24 * HOUR) });
}

const pairs = (rows: Awaited<ReturnType<typeof history.loadConfusions>>) =>
  rows.map((row) => `${row.exercise}: ${row.pickedId} for ${row.targetId} x${row.times}`).sort();

test("wrong picks are matched back to a word: by meaning for word exercises, by spelling for missing-word ones", async () => {
  await addUsers(ME);
  await addWords(["apple", "pear", "plum"]);
  await miss({ target: "lexeme:apple", picked: "gloss pear" });
  await miss({ target: "lexeme:apple", picked: "gloss pear" });
  await miss({ target: "lexeme:apple", picked: "fa-plum", exercise: "cloze" });
  // A spelling is not a meaning: this pick matches nothing in a word exercise.
  await miss({ target: "lexeme:apple", picked: "fa-plum" });

  const rows = await history.loadConfusions(ME, NOW);
  assert.deepEqual(pairs(rows), ["cloze: plum for apple x1", "word: pear for apple x2"]);
  // The most frequent first.
  assert.equal(rows[0].pickedId, "pear");
  assert.equal(rows[0].picked, "gloss pear");
});

test("what is not a mix-up of two words is left out", async () => {
  await addUsers(ME, OTHER);
  await addWords(["apple", "pear"]);
  await addWords(["theirs"], OTHER);
  await miss({ target: "lexeme:apple", picked: "gloss pear", correct: true }); // not wrong
  await miss({ target: null, picked: null }); // from before picks were recorded
  await miss({ target: "lexeme:apple", picked: null });
  await miss({ target: "pattern:apple", picked: "gloss pear" }); // about grammar, not a word
  await miss({ target: "lexeme:apple", picked: "english of a sentence", exercise: "listen" });
  await miss({ target: "lexeme:apple", picked: "fa-pear fa-apple", exercise: "tiles" });
  await miss({ target: "lexeme:apple", picked: "gloss apple" }); // its own meaning
  await miss({ target: "lexeme:apple", picked: "gloss theirs" }); // another learner's word
  await miss({ target: "lexeme:apple", picked: "gloss pear", daysAgo: 200 }); // long ago
  await miss({ userId: OTHER, target: "lexeme:apple", picked: "gloss pear" }); // someone else's answer

  assert.deepEqual(await history.loadConfusions(ME, NOW), []);
  assert.deepEqual(pairs(await history.loadConfusions(OTHER, NOW)), ["word: pear for apple x1"]);
});

test("a meaning shared by two words comes back once for each", async () => {
  await addUsers(ME);
  await addWords(["apple"]);
  await db.insert(lexemes).values([
    { id: "pear-a", fa: "fa-a", voc: "a", translit: "a", gloss: "pear" },
    { id: "pear-b", fa: "fa-b", voc: "b", translit: "b", gloss: "pear" },
  ]);
  await miss({ target: "lexeme:apple", picked: "pear" });
  assert.deepEqual(pairs(await history.loadConfusions(ME, NOW)), ["word: pear-a for apple x1", "word: pear-b for apple x1"]);
});
