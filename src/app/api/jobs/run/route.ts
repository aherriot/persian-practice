import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { kickWorker, work } from "@/lib/lesson/background";
import { reportError } from "@/lib/report-error";

export const runtime = "nodejs";

/**
 * The longest a worker may live, in seconds. It is this route's own limit,
 * which is the point of having a route: the work is not squeezed into whatever
 * is left of the page request that asked for it.
 */
export const maxDuration = 300;

/**
 * No new step is started after this long. What is left of `maxDuration` is
 * for the step under way: one sentence's audio, which is retried up to six
 * times and listened to twice. A step that still runs out of time is not
 * lost work; the job's lease expires and the next worker repeats that step.
 */
const BUDGET_MS = 180_000;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // With no secret set this is open on a developer's machine and shut anywhere else.
  if (!secret) return process.env.NODE_ENV !== "production";
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Works through the job queue (src/lib/jobs/queue.ts). Answers at once and
 * does the work afterwards, so whoever nudges it does not wait.
 *
 * Nudged by the app whenever it queues a job (POST), and by a daily cron as a
 * sweep for anything a nudge missed (GET, which is what Vercel Cron sends).
 * Both carry `Authorization: Bearer $CRON_SECRET`.
 */
async function run(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ error: "not allowed" }, { status: 401 });
  after(async () => {
    try {
      const { more } = await work(BUDGET_MS);
      // Out of time with jobs still waiting: hand over to a fresh worker.
      if (more) await kickWorker();
    } catch (err) {
      reportError("jobs.run", err);
    }
  });
  return Response.json({ ok: true }, { status: 202 });
}

export const GET = (request: Request) => run(request);
export const POST = (request: Request) => run(request);
