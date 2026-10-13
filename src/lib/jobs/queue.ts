import { and, eq, gte, lt, lte, ne, or, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, type JobKind } from "@/lib/db/schema";
import { reportError } from "@/lib/report-error";

/**
 * A work queue in the database, for slow work that must outlive the request
 * that asked for it.
 *
 * A worker *leases* a job: it writes its own id and an expiry on the row, in
 * one statement, and only the holder of a live lease may change the job. The
 * lease is renewed before every step. A worker that is cut off (a serverless
 * function at its time limit) simply stops renewing, and once the lease runs
 * out another worker takes the job and carries on from the last step that was
 * saved. Nothing here needs a transaction or a connection that stays open,
 * which the HTTP database driver does not have.
 */

export type Job = typeof jobs.$inferSelect;

/** Longer than any worker may run, so a lease only runs out on a worker that has stopped. */
export const LEASE_MS = 6 * 60_000;
/** Steps started in a row without one finishing before the job is given up on. */
export const MAX_ATTEMPTS = 3;
/** How long a job waits after its first, second… failed step. */
const BACKOFF_MS = [60_000, 5 * 60_000];
/** Finished jobs are kept this long, to be looked at when something went wrong. */
const KEEP_FINISHED_MS = 7 * 24 * 60 * 60_000;

const stamp = (date: Date) => sql`${date.toISOString()}::timestamp`;

/** Queues work unless the same work is already waiting or under way. True if it was queued. */
export async function enqueue(userId: string, kind: JobKind, key: string, payload: Record<string, unknown> = {}): Promise<boolean> {
  const added = await db.insert(jobs).values({ userId, kind, key, payload }).onConflictDoNothing().returning({ id: jobs.id });
  return added.length > 0;
}

/**
 * Takes the oldest job that is ready and that nobody holds, or null. A learner
 * with a job under way is passed over, so one learner's jobs run one at a time.
 */
export async function claim(workerId: string, now = new Date()): Promise<Job | null> {
  // A job whose steps keep being cut off never reports a failure of its own.
  await db
    .update(jobs)
    .set({ status: "failed", finishedAt: now, leaseId: null, leaseUntil: null, lastError: sql`coalesce(${jobs.lastError}, 'cut off before finishing a step')` })
    .where(and(eq(jobs.status, "pending"), gte(jobs.attempts, MAX_ATTEMPTS), or(isNull(jobs.leaseUntil), lt(jobs.leaseUntil, now))));

  const next = sql`(
    select j."id" from ${jobs} j
    where j."status" = 'pending' and j."runAfter" <= ${stamp(now)}
      and (j."leaseUntil" is null or j."leaseUntil" < ${stamp(now)})
      and not exists (
        select 1 from ${jobs} o
        where o."userId" = j."userId" and o."id" <> j."id" and o."status" = 'pending' and o."leaseUntil" >= ${stamp(now)}
      )
    order by j."createdAt", j."id"
    limit 1
    for update skip locked
  )`;
  const [job] = await db
    .update(jobs)
    .set({ leaseId: workerId, leaseUntil: new Date(now.getTime() + LEASE_MS) })
    .where(eq(jobs.id, next))
    .returning();
  return job ?? null;
}

const held = (job: Job, workerId: string) => and(eq(jobs.id, job.id), eq(jobs.leaseId, workerId), eq(jobs.status, "pending"));

/** Renews the lease before a step. False if the job is no longer this worker's. */
export async function beginStep(job: Job, workerId: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ attempts: sql`${jobs.attempts} + 1`, leaseUntil: new Date(now.getTime() + LEASE_MS) })
    .where(held(job, workerId))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** Saves what a finished step produced. False if the lease was lost meanwhile, in which case nothing is saved. */
export async function saveStep(job: Job, workerId: string, state: unknown): Promise<boolean> {
  const rows = await db.update(jobs).set({ state, attempts: 0, lastError: null }).where(held(job, workerId)).returning({ id: jobs.id });
  return rows.length > 0;
}

export async function finish(job: Job, workerId: string, now = new Date()): Promise<void> {
  await db.update(jobs).set({ status: "done", finishedAt: now, attempts: 0, leaseId: null, leaseUntil: null }).where(held(job, workerId));
}

/** Hands a job back unfinished, for the next worker to carry on with. */
export async function release(job: Job, workerId: string): Promise<void> {
  await db.update(jobs).set({ attempts: 0, leaseId: null, leaseUntil: null }).where(held(job, workerId));
}

/** A step threw: try again later, or give up if it has failed too often. Returns whether it will be tried again. */
export async function fail(job: Job, workerId: string, err: unknown, now = new Date()): Promise<boolean> {
  const lastError = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  const [row] = await db
    .update(jobs)
    .set({
      lastError,
      leaseId: null,
      leaseUntil: null,
      status: sql`case when ${jobs.attempts} >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end`,
      finishedAt: sql`case when ${jobs.attempts} >= ${MAX_ATTEMPTS} then ${stamp(now)} end`,
      runAfter: sql`${stamp(now)} + (case ${jobs.attempts} ${sql.raw(BACKOFF_MS.map((ms, i) => `when ${i + 1} then ${ms / 1000}`).join(" "))} else 0 end) * interval '1 second'`,
    })
    .where(held(job, workerId))
    .returning({ status: jobs.status });
  return row?.status === "pending";
}

/** Whether any job could be taken right now. */
export async function hasReady(now = new Date()): Promise<boolean> {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lte(jobs.runAfter, now), or(isNull(jobs.leaseUntil), lt(jobs.leaseUntil, now))))
    .limit(1);
  return rows.length > 0;
}

/** Forgets jobs that finished long ago. */
export async function forgetFinished(now = new Date()): Promise<void> {
  await db.delete(jobs).where(and(ne(jobs.status, "pending"), lt(jobs.finishedAt, new Date(now.getTime() - KEEP_FINISHED_MS))));
}

export type Handler = {
  /** Does one step from `job.state` and returns the state to save, or null when the job is finished. */
  step(job: Job): Promise<unknown | null>;
  /**
   * True if the job's next step may take most of a worker's time. Such a step
   * is only ever a worker's first, so it has the whole time limit to itself.
   */
  slow?(job: Job): boolean;
};

export type RunResult = {
  /** Steps finished. */
  steps: number;
  /** Jobs are still waiting that a fresh worker could take now. */
  more: boolean;
};

/**
 * Works through the queue until it is empty or `budgetMs` has gone. The budget
 * is checked between steps: a step that has started is left to finish, so
 * leave room under the real time limit for one.
 */
export async function runJobs(
  handlers: Record<JobKind, Handler>,
  { budgetMs, workerId = crypto.randomUUID() }: { budgetMs: number; workerId?: string },
): Promise<RunResult> {
  const started = Date.now();
  const inTime = () => Date.now() - started < budgetMs;
  let steps = 0;

  while (inTime()) {
    const job = await claim(workerId);
    if (!job) break;
    const handler = handlers[job.kind];
    for (;;) {
      if (!inTime() || (steps > 0 && handler.slow?.(job))) {
        await release(job, workerId);
        return { steps, more: true };
      }
      if (!(await beginStep(job, workerId))) break;
      let next: unknown | null;
      try {
        next = await handler.step(job);
      } catch (err) {
        reportError("job", err, { jobId: job.id, kind: job.kind, userId: job.userId });
        await fail(job, workerId, err);
        break;
      }
      steps++;
      if (next === null) {
        await finish(job, workerId);
        break;
      }
      if (!(await saveStep(job, workerId, next))) break;
      job.state = next;
    }
  }
  return { steps, more: await hasReady() };
}
