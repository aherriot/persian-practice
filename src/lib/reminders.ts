import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNotNull, lte, max, sql } from "drizzle-orm";
import { devAuthEnabled } from "@/lib/auth/dev-mode";
import { db } from "@/lib/db";
import { knowledge, reviewLog, users } from "@/lib/db/schema";
import { reportError } from "@/lib/report-error";

/**
 * The daily reminder email: sent to a learner who asked for it, on a day when
 * something is due and they have not practised yet.
 *
 * It is sent by a cron job that runs once a day at one fixed time (see
 * vercel.json), not at a time of the learner's choosing. "Today" is still the
 * learner's own day, from the time zone their browser reported when they
 * turned reminders on — so someone far east of the cron's hour, for whom it is
 * already tomorrow, is asked about tomorrow, not about the day just ended.
 */

const HOUR_MS = 60 * 60 * 1000;
/** No second email within this long of the last, however often the cron runs. */
const MIN_GAP_MS = 20 * HOUR_MS;
/** How far back to look for today's practice: longer than any day in any zone. */
const RECENT_MS = 48 * HOUR_MS;

export type Email = {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
};

/** How an email leaves. Passed in, so nothing outside production (or a test) can send one by accident. */
export type Send = (email: Email) => Promise<void>;

// --- Unsubscribing without signing in ---

const sign = (userId: string, secret: string) => createHmac("sha256", secret).update(`reminders:unsubscribe:${userId}`).digest("base64url");

/** A token that proves a link came from an email sent to this learner. It does not expire: an old email must still unsubscribe. */
export function unsubscribeToken(userId: string, secret: string): string {
  return sign(userId, secret);
}

export function verifyUnsubscribeToken(userId: string, token: string, secret: string): boolean {
  const expected = Buffer.from(sign(userId, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function unsubscribeUrl(baseUrl: string, userId: string, secret: string, path = "/unsubscribe"): string {
  const url = new URL(path, baseUrl);
  url.searchParams.set("u", userId);
  url.searchParams.set("t", unsubscribeToken(userId, secret));
  return url.toString();
}

// --- Who gets one ---

/** The calendar day at `date` in a time zone, as 2026-10-12. An unknown zone is read as UTC. */
export function localDay(date: Date, timeZone: string | null): string {
  const format = (zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  try {
    return format(timeZone ?? "UTC");
  } catch {
    return format("UTC");
  }
}

export type Candidate = {
  due: number;
  lastAnsweredAt: Date | null;
  lastRemindedAt: Date | null;
  timeZone: string | null;
};

export function shouldRemind(candidate: Candidate, now: Date): boolean {
  if (candidate.due === 0) return false;
  if (candidate.lastRemindedAt && now.getTime() - candidate.lastRemindedAt.getTime() < MIN_GAP_MS) return false;
  const today = localDay(now, candidate.timeZone);
  return !candidate.lastAnsweredAt || localDay(candidate.lastAnsweredAt, candidate.timeZone) !== today;
}

// --- What it says ---

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function reminderEmail(to: string, due: number, links: { practise: string; unsubscribe: string; oneClick: string }): Email {
  const things = due === 1 ? "1 thing is" : `${due} things are`;
  const line = `${things} due for review, and you have not practised today. A few minutes now keeps ${due === 1 ? "it" : "them"} from slipping.`;
  return {
    to,
    subject: due === 1 ? "1 thing to review in Persian Practice" : `${due} things to review in Persian Practice`,
    text: `${line}\n\nPractise: ${links.practise}\n\nYou asked for this reminder. To stop it: ${links.unsubscribe}\n`,
    html: [
      `<p>${escapeHtml(line)}</p>`,
      `<p><a href="${escapeHtml(links.practise)}">Practise now</a></p>`,
      `<p style="color:#666;font-size:12px">You asked for this reminder. <a href="${escapeHtml(links.unsubscribe)}">Stop these emails</a>.</p>`,
    ].join("\n"),
    headers: {
      // What a mail client's own "unsubscribe" button uses (RFC 8058).
      "List-Unsubscribe": `<${links.oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

// --- Sending ---

export type ReminderRun = { sent: number; notNeeded: number; failed: number };

/**
 * Sends today's reminders. One learner's failure does not stop the rest, and a
 * learner is only marked as reminded once their email has gone.
 */
export async function sendReminders(opts: { now: Date; baseUrl: string; secret: string; send: Send }): Promise<ReminderRun> {
  const { now, baseUrl, secret, send } = opts;
  const due = db
    // A word due in more than one skill is still one thing due.
    .select({ userId: knowledge.userId, n: sql<number>`count(distinct (${knowledge.kind}, ${knowledge.refId}))::int`.as("n") })
    .from(knowledge)
    .where(lte(knowledge.dueAt, now))
    .groupBy(knowledge.userId)
    .as("due");
  const last = db
    .select({ userId: reviewLog.userId, at: max(reviewLog.createdAt).as("at") })
    .from(reviewLog)
    .where(gt(reviewLog.createdAt, new Date(now.getTime() - RECENT_MS)))
    .groupBy(reviewLog.userId)
    .as("last");
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      timeZone: users.timeZone,
      lastRemindedAt: users.lastRemindedAt,
      due: due.n,
      lastAnsweredAt: last.at,
    })
    .from(users)
    // Nothing due, no row: nobody is reminded of nothing.
    .innerJoin(due, eq(due.userId, users.id))
    .leftJoin(last, eq(last.userId, users.id))
    .where(and(eq(users.reminders, true), isNotNull(users.email)));

  const run: ReminderRun = { sent: 0, notNeeded: 0, failed: 0 };
  for (const row of rows) {
    if (!shouldRemind(row, now)) {
      run.notNeeded++;
      continue;
    }
    try {
      await send(
        reminderEmail(row.email!, row.due, {
          practise: new URL("/practice", baseUrl).toString(),
          unsubscribe: unsubscribeUrl(baseUrl, row.id, secret),
          oneClick: unsubscribeUrl(baseUrl, row.id, secret, "/api/reminders/unsubscribe"),
        }),
      );
      await db.update(users).set({ lastRemindedAt: now }).where(eq(users.id, row.id));
      run.sent++;
    } catch (err) {
      reportError("reminders", err, { userId: row.id });
      run.failed++;
    }
  }
  return run;
}

/** Sends through Resend's HTTP API, the service the sign-in emails already use. */
const resend =
  (apiKey: string, from: string): Send =>
  async (email) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, ...email }),
    });
    if (!response.ok) throw new Error(`resend ${response.status}: ${(await response.text()).slice(0, 200)}`);
  };

/**
 * The sender the cron uses. A real one only in real production; everywhere
 * else (local, CI, preview deploys) the email is written to the server log
 * and goes nowhere, like the sign-in link.
 */
export function productionSend(): Send {
  const apiKey = process.env.AUTH_RESEND_KEY;
  if (devAuthEnabled) {
    return async (email) => {
      console.log(`\n✉️  Reminder not sent (no email leaves outside production). To ${email.to}: ${email.subject}\n${email.text}`);
    };
  }
  // Failing is right in production: a learner must not be marked as reminded by an email that never went.
  if (!apiKey) throw new Error("AUTH_RESEND_KEY is not set — cannot send reminder emails.");
  return resend(apiKey, process.env.EMAIL_FROM ?? "Persian Practice <onboarding@resend.dev>");
}

// --- The learner's setting ---

export async function loadReminderSetting(userId: string): Promise<boolean> {
  const [row] = await db.select({ reminders: users.reminders }).from(users).where(eq(users.id, userId));
  return row?.reminders ?? false;
}

/** Turns the reminder on or off. The time zone is only recorded when it is one this server can use. */
export async function setReminders(userId: string, enabled: boolean, timeZone?: string | null): Promise<void> {
  let zone: string | undefined;
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone });
      zone = timeZone;
    } catch {
      // Left as it was.
    }
  }
  await db
    .update(users)
    .set({ reminders: enabled, ...(zone ? { timeZone: zone } : {}) })
    .where(eq(users.id, userId));
}

/** Turns the reminder off for whoever holds a valid link from one of their emails. False if the link is not valid. */
export async function unsubscribe(userId: string, token: string, secret: string): Promise<boolean> {
  if (!verifyUnsubscribeToken(userId, token, secret)) return false;
  await setReminders(userId, false);
  return true;
}
