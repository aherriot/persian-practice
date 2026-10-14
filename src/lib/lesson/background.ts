import { and, eq } from "drizzle-orm";
import { wordClip } from "@/lib/audio-key";
import { makeVerifiedClip } from "@/lib/audio-store";
import { db } from "@/lib/db";
import { lexemes } from "@/lib/db/schema";
import { enqueue, forgetFinished, runJobs, type Handler, type RunResult } from "@/lib/jobs/queue";
import { reportError } from "@/lib/report-error";
import { reviewCandidates } from "./drafts";
import { draftFrontier, storeFrontier } from "./expand";
import { draftPractice, storePractice } from "./generate";
import { isSlow, prepareStep, type Stages } from "./prepare";
import { draftLessonsFor, storeLesson } from "./word-lessons";

/**
 * Content is got ready for a learner by jobs on a queue, not inside the
 * request that noticed it was needed: a page or route queues the job and
 * nudges the worker (/api/jobs/run), which has a time limit of its own and
 * carries a job on from wherever the last worker left it. What the jobs do,
 * step by step, is in prepare.ts.
 */

const stages: Stages = {
  draftFrontier,
  storeFrontier,
  draftPractice,
  storePractice,
  review: reviewCandidates,
  draftLessons: (userId, lexemeId) => draftLessonsFor(userId, lexemeId),
  storeLesson: (userId, candidate) => storeLesson(userId, candidate),
  async makeWordClip(userId, lexemeId) {
    const word = await db.query.lexemes.findFirst({ where: and(eq(lexemes.id, lexemeId), eq(lexemes.ownerId, userId)) });
    if (word) await makeVerifiedClip(wordClip(word));
  },
};

const handler: Handler = { step: (job) => prepareStep(job, stages), slow: isSlow };

/** Works through the queue for up to `budgetMs`, then says whether there is more to do. */
export async function work(budgetMs: number): Promise<RunResult> {
  await forgetFinished().catch((err) => reportError("jobs.forget", err));
  return runJobs({ session: handler, word: handler }, { budgetMs });
}

/** New material and fresh sentences for the learner's next session. Queued once however often it is asked for. */
export const queueSessionPrep = (userId: string) => enqueue(userId, "session", `session:${userId}`);

/** Audio and example sentences for a word the learner has just added. */
export const queueWordPrep = (userId: string, lexemeId: string) =>
  enqueue(userId, "word", `word:${userId}:${lexemeId}`, { lexemeId });

/** Without a worker to hand over to, this much is done in the request that asked. */
const INLINE_BUDGET_MS = 45_000;

/**
 * Where this deployment can be reached from itself. Never taken from the
 * request: the worker's secret is sent to this address.
 */
function ownOrigin(): string | null {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NODE_ENV !== "production") return `http://localhost:${process.env.PORT ?? 3000}`;
  return null;
}

/**
 * Starts a worker on the queue. Call after the response has been sent.
 *
 * Normally this is one quick request to /api/jobs/run, which answers at once
 * and does the work in its own time. If that cannot be done — no CRON_SECRET
 * set, or the address is not reachable — some of the work is done here
 * instead, in whatever time this request has left, and the rest waits for the
 * next nudge or the daily sweep.
 */
export async function kickWorker(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  const origin = ownOrigin();
  if (secret && origin) {
    try {
      const response = await fetch(`${origin}/api/jobs/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return;
      throw new Error(`worker answered ${response.status}`);
    } catch (err) {
      reportError("jobs.kick", err, { origin });
    }
  }
  await work(INLINE_BUDGET_MS).catch((err) => reportError("jobs.work", err));
}

/** For `after()` on a session page: queue the learner's preparation and start a worker. */
export async function prepareNextSession(userId: string): Promise<void> {
  try {
    await queueSessionPrep(userId);
    await kickWorker();
  } catch (err) {
    reportError("prepareNextSession", err, { userId });
  }
}

/** For `after()` when a learner adds a word. */
export async function prepareWord(userId: string, lexemeId: string): Promise<void> {
  try {
    await queueWordPrep(userId, lexemeId);
    await kickWorker();
  } catch (err) {
    reportError("prepareWord", err, { userId, lexemeId });
  }
}
