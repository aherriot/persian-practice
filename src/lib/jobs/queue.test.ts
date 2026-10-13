// The job queue against a real Postgres (PGlite): what makes it safe for two
// workers to run at once, and for a worker to be cut off part-way.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { closeTestDb, createTestDb, emptyTestDb, type TestDb } from "../db/test-db.ts";
import { jobs, users } from "../db/schema.ts";

let db: TestDb;
let queue: typeof import("./queue.ts");

before(async () => {
  db = await createTestDb();
  // Only now: queue.ts imports the database, which must already be the test one.
  queue = await import("./queue.ts");
});

beforeEach(async () => {
  await emptyTestDb(db);
  await db.insert(users).values([ME, OTHER].map((id) => ({ id, email: `${id}@example.com` })));
});
after(() => closeTestDb(db));

const ME = "learner-me";
const OTHER = "learner-other";
// Just ahead of the clock: a job is queued as ready from the moment the database stores it.
const NOW = new Date(Date.now() + 5_000);
const later = (ms: number) => new Date(NOW.getTime() + ms);
const MINUTE = 60_000;

const stored = async (key: string) => (await db.select().from(jobs).where(eq(jobs.key, key)))[0];
/** Silences the error line a failing step reports, which is expected here. */
const quietly = async <T>(run: () => Promise<T>): Promise<T> => {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
};

// --- Queuing ---

test("the same work asked for twice is queued once", async () => {
  assert.equal(await queue.enqueue(ME, "session", "session:me"), true);
  assert.equal(await queue.enqueue(ME, "session", "session:me"), false);
  assert.equal((await db.select().from(jobs)).length, 1);
});

test("work can be queued again once the earlier job has finished", async () => {
  await queue.enqueue(ME, "session", "session:me");
  const job = (await queue.claim("w1", NOW))!;
  await queue.finish(job, "w1", NOW);
  assert.equal(await queue.enqueue(ME, "session", "session:me"), true);
  assert.equal((await db.select().from(jobs)).length, 2);
});

// --- Leases ---

test("a job one worker holds is not given to another", async () => {
  await queue.enqueue(ME, "session", "session:me");
  const mine = await queue.claim("w1", NOW);
  assert.equal(mine?.leaseId, "w1");
  assert.equal(await queue.claim("w2", later(MINUTE)), null);
});

test("two workers asking at the same moment get different jobs, never the same one", async () => {
  await queue.enqueue(ME, "session", "session:me");
  await queue.enqueue(OTHER, "session", "session:other");
  const [a, b] = await Promise.all([queue.claim("w1", NOW), queue.claim("w2", NOW)]);
  assert.ok(a && b);
  assert.notEqual(a.id, b.id);
});

test("a lease that has run out is taken over, and the job carries on from its saved state", async () => {
  await queue.enqueue(ME, "session", "session:me");
  const first = (await queue.claim("w1", NOW))!;
  await queue.beginStep(first, "w1", NOW);
  await queue.saveStep(first, "w1", { step: 1 });
  // w1 is cut off here and never comes back.

  assert.equal(await queue.claim("w2", later(queue.LEASE_MS - 1)), null);
  const second = await queue.claim("w2", later(queue.LEASE_MS + 1));
  assert.equal(second?.id, first.id);
  assert.deepEqual(second?.state, { step: 1 });
});

test("a worker that has lost its lease can no longer change the job", async () => {
  await queue.enqueue(ME, "session", "session:me");
  const job = (await queue.claim("w1", NOW))!;
  const taken = await queue.claim("w2", later(queue.LEASE_MS + 1));
  assert.ok(taken);

  assert.equal(await queue.beginStep(job, "w1", later(queue.LEASE_MS + 2)), false);
  assert.equal(await queue.saveStep(job, "w1", { step: "stale" }), false);
  await queue.finish(job, "w1");
  const row = await stored("session:me");
  assert.equal(row.status, "pending");
  assert.equal(row.leaseId, "w2");
  assert.equal(row.state, null);
});

test("one learner's jobs run one at a time; another learner's are not held up", async () => {
  await queue.enqueue(ME, "session", "session:me");
  await queue.enqueue(ME, "word", "word:me:apple");
  await queue.enqueue(OTHER, "session", "session:other");

  const first = await queue.claim("w1", NOW);
  assert.equal(first?.key, "session:me");
  const second = await queue.claim("w2", NOW);
  assert.equal(second?.key, "session:other");
  assert.equal(await queue.claim("w3", NOW), null);

  await queue.finish(first!, "w1", NOW);
  assert.equal((await queue.claim("w3", NOW))?.key, "word:me:apple");
});

// --- Failure ---

test("a failed step waits before it is tried again, and the job is given up on after three in a row", async () => {
  await queue.enqueue(ME, "session", "session:me");

  let job = (await queue.claim("w1", NOW))!;
  await queue.beginStep(job, "w1", NOW);
  assert.equal(await queue.fail(job, "w1", new Error("speech service down"), NOW), true);
  assert.equal(await queue.claim("w1", later(30_000)), null);

  job = (await queue.claim("w1", later(MINUTE)))!;
  await queue.beginStep(job, "w1", later(MINUTE));
  assert.equal(await queue.fail(job, "w1", new Error("speech service down"), later(MINUTE)), true);
  assert.equal(await queue.claim("w1", later(5 * MINUTE)), null);

  job = (await queue.claim("w1", later(6 * MINUTE)))!;
  await queue.beginStep(job, "w1", later(6 * MINUTE));
  assert.equal(await queue.fail(job, "w1", new Error("speech service down"), later(6 * MINUTE)), false);

  const row = await stored("session:me");
  assert.equal(row.status, "failed");
  assert.equal(row.lastError, "speech service down");
  assert.equal(await queue.claim("w1", later(60 * MINUTE)), null);
});

test("a finished step clears the count of failures", async () => {
  await queue.enqueue(ME, "session", "session:me");
  const job = (await queue.claim("w1", NOW))!;
  await queue.beginStep(job, "w1", NOW);
  await queue.fail(job, "w1", new Error("once"), NOW);

  const again = (await queue.claim("w1", later(MINUTE)))!;
  await queue.beginStep(again, "w1", later(MINUTE));
  await queue.saveStep(again, "w1", { step: 1 });
  assert.equal((await stored("session:me")).attempts, 0);
});

test("a job whose step is cut off three times running is given up on", async () => {
  await queue.enqueue(ME, "session", "session:me");
  let at = NOW;
  for (let n = 0; n < queue.MAX_ATTEMPTS; n++) {
    const job = (await queue.claim(`w${n}`, at))!;
    assert.ok(job, `attempt ${n + 1} is allowed`);
    await queue.beginStep(job, `w${n}`, at);
    // Cut off: no save, no failure reported.
    at = new Date(at.getTime() + queue.LEASE_MS + 1);
  }
  assert.equal(await queue.claim("last", at), null);
  assert.equal((await stored("session:me")).status, "failed");
});

// --- The worker loop ---

test("a worker does a job step by step and saves after each", async () => {
  await queue.enqueue(ME, "session", "session:me");
  const seen: unknown[] = [];
  const handler = {
    async step(job: { state: unknown }) {
      seen.push(job.state);
      const n = ((job.state as { n: number } | null)?.n ?? 0) + 1;
      return n < 3 ? { n } : null;
    },
  };
  const result = await queue.runJobs({ session: handler, word: handler }, { budgetMs: 60_000 });
  assert.deepEqual(seen, [null, { n: 1 }, { n: 2 }]);
  assert.deepEqual(result, { steps: 3, more: false });
  assert.equal((await stored("session:me")).status, "done");
});

test("a step that throws keeps what the steps before it saved", async () => {
  await queue.enqueue(ME, "session", "session:me");
  const handler = {
    async step(job: { state: unknown }) {
      if (job.state) throw new Error("speech service down");
      return { drafted: ["a", "b"] };
    },
  };
  const result = await quietly(() => queue.runJobs({ session: handler, word: handler }, { budgetMs: 60_000 }));
  assert.equal(result.steps, 1);
  const row = await stored("session:me");
  assert.equal(row.status, "pending");
  assert.deepEqual(row.state, { drafted: ["a", "b"] });
  assert.equal(row.leaseId, null);
});

test("a slow step is left for a fresh worker unless it is this worker's first", async () => {
  await queue.enqueue(ME, "session", "session:me");
  const done: string[] = [];
  const handler = {
    async step(job: { state: unknown }) {
      const at = (job.state as { at: string } | null)?.at ?? "draft";
      done.push(at);
      return at === "draft" ? { at: "review" } : at === "review" ? { at: "store" } : null;
    },
    slow: (job: { state: unknown }) => (job.state as { at: string } | null)?.at !== "store",
  };
  const handlers = { session: handler, word: handler };

  assert.deepEqual(await queue.runJobs(handlers, { budgetMs: 60_000 }), { steps: 1, more: true });
  assert.deepEqual(done, ["draft"]);
  assert.deepEqual(await queue.runJobs(handlers, { budgetMs: 60_000 }), { steps: 2, more: false });
  assert.deepEqual(done, ["draft", "review", "store"]);
});

test("a worker out of time hands its job back, saved, for the next one", async () => {
  await queue.enqueue(ME, "session", "session:me");
  const handler = {
    async step(job: { state: unknown }) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { n: ((job.state as { n: number } | null)?.n ?? 0) + 1 };
    },
  };
  const result = await queue.runJobs({ session: handler, word: handler }, { budgetMs: 10 });
  assert.deepEqual(result, { steps: 1, more: true });
  const row = await stored("session:me");
  assert.equal(row.leaseId, null);
  assert.deepEqual(row.state, { n: 1 });
});
