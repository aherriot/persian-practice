// The queries behind the dashboard and progress page, run against a real
// Postgres (PGlite) with the project's migrations applied.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { closeTestDb, createTestDb, emptyTestDb, type TestDb } from "../db/test-db.ts";
import { reviewLog, users } from "../db/schema.ts";
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
