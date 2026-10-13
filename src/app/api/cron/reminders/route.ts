import { timingSafeEqual } from "node:crypto";
import { reportError } from "@/lib/report-error";
import { productionSend, sendReminders } from "@/lib/reminders";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Sends the day's reminder emails. Called by the cron in vercel.json, which
 * presents CRON_SECRET as a bearer token; without that secret set, or without
 * it presented, nothing runs.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "not authorised" }, { status: 401 });
  }
  const signing = process.env.AUTH_SECRET;
  if (!signing) return Response.json({ error: "AUTH_SECRET is not set" }, { status: 500 });

  try {
    const run = await sendReminders({
      now: new Date(),
      baseUrl: process.env.APP_URL ?? new URL(request.url).origin,
      secret: signing,
      send: productionSend(),
    });
    return Response.json(run);
  } catch (err) {
    reportError("reminders", err);
    return Response.json({ error: "reminders failed" }, { status: 500 });
  }
}
