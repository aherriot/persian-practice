// The reminder email. The pure rules are tested directly; who is sent one is
// tested against a real Postgres (PGlite), with a fake in place of the sender:
// no test can send an email.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { closeTestDb, createTestDb, emptyTestDb, type TestDb } from "./db/test-db.ts";
import { knowledge, reviewLog, users } from "./db/schema.ts";
import type { Email } from "./reminders.ts";
import { SKILLS } from "./lesson/types.ts";

let db: TestDb;
let reminders: typeof import("./reminders.ts");

before(async () => {
  db = await createTestDb();
  reminders = await import("./reminders.ts");
});
beforeEach(() => emptyTestDb(db));
after(() => closeTestDb(db));

// 15:00 UTC on the 11th: 11:00 in Toronto, and already 04:00 on the 12th in Auckland.
const NOW = new Date("2026-10-11T15:00:00Z");
const HOUR = 60 * 60 * 1000;
const SECRET = "test-secret";
const BASE = "https://persian.example";

const hoursAgo = (n: number) => new Date(NOW.getTime() - n * HOUR);

// --- The rules ---

test("a day is the learner's own, and an unknown zone is read as UTC", () => {
  assert.equal(reminders.localDay(NOW, "America/Toronto"), "2026-10-11");
  assert.equal(reminders.localDay(NOW, "Pacific/Auckland"), "2026-10-12");
  assert.equal(reminders.localDay(NOW, null), "2026-10-11");
  assert.equal(reminders.localDay(NOW, "Not/AZone"), "2026-10-11");
});

test("a reminder is for someone with something due who has not practised today", () => {
  const candidate = { due: 3, lastAnsweredAt: null, lastRemindedAt: null, timeZone: "America/Toronto" };
  assert.equal(reminders.shouldRemind(candidate, NOW), true);
  assert.equal(reminders.shouldRemind({ ...candidate, due: 0 }, NOW), false);
  // 08:00 this morning in Toronto: practised today.
  assert.equal(reminders.shouldRemind({ ...candidate, lastAnsweredAt: hoursAgo(3) }, NOW), false);
  // 21:00 last night in Toronto: not today.
  assert.equal(reminders.shouldRemind({ ...candidate, lastAnsweredAt: hoursAgo(14) }, NOW), true);
});

test("today is judged in the learner's zone, not the server's", () => {
  // Three hours ago is 01:00 on the 12th in Auckland, which is their today…
  const auckland = { due: 1, lastAnsweredAt: hoursAgo(3), lastRemindedAt: null, timeZone: "Pacific/Auckland" };
  assert.equal(reminders.shouldRemind(auckland, NOW), false);
  // …but six hours ago was 22:00 on the 11th, their yesterday, though the same UTC day.
  assert.equal(reminders.shouldRemind({ ...auckland, lastAnsweredAt: hoursAgo(6) }, NOW), true);
});

test("nobody is reminded twice within a day, however often the job runs", () => {
  const candidate = { due: 3, lastAnsweredAt: null, timeZone: null };
  assert.equal(reminders.shouldRemind({ ...candidate, lastRemindedAt: hoursAgo(1) }, NOW), false);
  assert.equal(reminders.shouldRemind({ ...candidate, lastRemindedAt: hoursAgo(24) }, NOW), true);
});

test("an unsubscribe token is good for one learner only", () => {
  const token = reminders.unsubscribeToken("learner-a", SECRET);
  assert.equal(reminders.verifyUnsubscribeToken("learner-a", token, SECRET), true);
  assert.equal(reminders.verifyUnsubscribeToken("learner-b", token, SECRET), false);
  assert.equal(reminders.verifyUnsubscribeToken("learner-a", token, "another-secret"), false);
  assert.equal(reminders.verifyUnsubscribeToken("learner-a", "", SECRET), false);
  assert.equal(reminders.verifyUnsubscribeToken("learner-a", `${token}x`, SECRET), false);
});

test("the email says what is due and carries a way out, for a person and for a mail client", () => {
  const links = { practise: `${BASE}/practice`, unsubscribe: `${BASE}/unsubscribe?u=a&t=b`, oneClick: `${BASE}/api/reminders/unsubscribe?u=a&t=b` };
  const email = reminders.reminderEmail("me@example.com", 4, links);
  assert.equal(email.to, "me@example.com");
  assert.match(email.subject, /^4 things to review/);
  assert.ok(email.text.includes(links.practise) && email.text.includes(links.unsubscribe));
  assert.ok(email.html.includes("u=a&amp;t=b"), "links are escaped in the HTML");
  assert.equal(email.headers["List-Unsubscribe"], `<${links.oneClick}>`);
  assert.equal(email.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(reminders.reminderEmail("me@example.com", 1, links).subject, /^1 thing to review/);
});

// --- Who is sent one ---

type Learner = {
  reminders?: boolean;
  email?: string | null;
  timeZone?: string | null;
  lastRemindedAt?: Date | null;
  /** Hours from now each thing they know falls due; negative is overdue. */
  dueInHours?: number[];
  /** Hours ago they answered something. */
  answeredHoursAgo?: number[];
};

async function addLearner(id: string, learner: Learner = {}) {
  const { reminders: on = true, email = `${id}@example.com`, timeZone = "America/Toronto", lastRemindedAt = null } = learner;
  await db.insert(users).values({ id, email, reminders: on, timeZone, lastRemindedAt });
  const due = learner.dueInHours ?? [-5];
  if (due.length > 0) {
    await db.insert(knowledge).values(
      // Due in every skill, as a word just met is: still one thing due.
      due.flatMap((hours, i) =>
        SKILLS.map((skill) => ({ userId: id, kind: "lexeme" as const, refId: `word-${i}`, skill, dueAt: new Date(NOW.getTime() + hours * HOUR) })),
      ),
    );
  }
  const answered = learner.answeredHoursAgo ?? [];
  if (answered.length > 0) {
    await db.insert(reviewLog).values(answered.map((hours) => ({ userId: id, exercise: "listen", correct: true, createdAt: hoursAgo(hours) })));
  }
}

function fakeSend(failFor: string[] = []) {
  const sent: Email[] = [];
  const send = async (email: Email) => {
    if (failFor.includes(email.to)) throw new Error("the mail service said no");
    sent.push(email);
  };
  return { sent, send };
}

const run = (send: (email: Email) => Promise<void>, now = NOW) => reminders.sendReminders({ now, baseUrl: BASE, secret: SECRET, send });

test("only a learner who asked, has something due and has not practised today is emailed", async () => {
  await addLearner("wants", { dueInHours: [-5, -1, 30], answeredHoursAgo: [14, 40] });
  await addLearner("did-not-ask", { reminders: false });
  await addLearner("nothing-due", { dueInHours: [30] });
  await addLearner("knows-nothing", { dueInHours: [] });
  await addLearner("practised-today", { answeredHoursAgo: [2] });
  await addLearner("no-address", { email: null });

  const { sent, send } = fakeSend();
  assert.deepEqual(await run(send), { sent: 1, notNeeded: 1, failed: 0 });
  assert.deepEqual(sent.map((email) => email.to), ["wants@example.com"]);
  // Two of the three things are due now.
  assert.match(sent[0].subject, /^2 things/);
  assert.ok(sent[0].text.includes(`${BASE}/practice`));
  assert.ok(sent[0].text.includes(reminders.unsubscribeUrl(BASE, "wants", SECRET)));
});

test("the job run twice sends once", async () => {
  await addLearner("wants");
  const { sent, send } = fakeSend();
  await run(send);
  const [row] = await db.select().from(users).where(eq(users.id, "wants"));
  assert.equal(row.lastRemindedAt?.getTime(), NOW.getTime());
  assert.deepEqual(await run(send, new Date(NOW.getTime() + HOUR)), { sent: 0, notNeeded: 1, failed: 0 });
  assert.equal(sent.length, 1);
  // The next day's run sends again.
  assert.equal((await run(send, new Date(NOW.getTime() + 24 * HOUR))).sent, 1);
});

test("one failed email neither stops the rest nor counts as sent", async (t) => {
  t.mock.method(console, "error", () => {});
  await addLearner("a");
  await addLearner("b");
  await addLearner("c");
  const { sent, send } = fakeSend(["b@example.com"]);
  assert.deepEqual(await run(send), { sent: 2, notNeeded: 0, failed: 1 });
  assert.deepEqual(sent.map((email) => email.to).sort(), ["a@example.com", "c@example.com"]);
  // b was not marked, so the next run tries again.
  const [b] = await db.select().from(users).where(eq(users.id, "b"));
  assert.equal(b.lastRemindedAt, null);
  const retry = fakeSend();
  assert.equal((await run(retry.send, new Date(NOW.getTime() + HOUR))).sent, 1);
  assert.deepEqual(retry.sent.map((email) => email.to), ["b@example.com"]);
});

test("someone for whom it is already tomorrow is asked about tomorrow", async () => {
  // Answered at 22:00 on the 11th, Auckland time; the job runs at 04:00 on the 12th.
  await addLearner("auckland", { timeZone: "Pacific/Auckland", answeredHoursAgo: [6] });
  const { sent, send } = fakeSend();
  await run(send);
  assert.equal(sent.length, 1);
});

// --- The setting ---

test("reminders are off until asked for, and the zone is kept only if it is a real one", async () => {
  await db.insert(users).values({ id: "me", email: "me@example.com" });
  assert.equal(await reminders.loadReminderSetting("me"), false);

  await reminders.setReminders("me", true, "Europe/London");
  assert.equal(await reminders.loadReminderSetting("me"), true);
  await reminders.setReminders("me", true, "Not/AZone");
  const [row] = await db.select().from(users).where(eq(users.id, "me"));
  assert.equal(row.timeZone, "Europe/London");

  await reminders.setReminders("me", false);
  assert.equal(await reminders.loadReminderSetting("me"), false);
  assert.equal(await reminders.loadReminderSetting("nobody"), false);
});

test("the link in an email turns reminders off without signing in, and a forged one does nothing", async () => {
  await addLearner("me");
  await addLearner("other");
  const token = reminders.unsubscribeToken("me", SECRET);

  assert.equal(await reminders.unsubscribe("other", token, SECRET), false);
  assert.equal(await reminders.loadReminderSetting("other"), true);

  assert.equal(await reminders.unsubscribe("me", token, SECRET), true);
  assert.equal(await reminders.loadReminderSetting("me"), false);
  assert.equal(await reminders.loadReminderSetting("other"), true);
  // And they are not emailed any more.
  const { sent, send } = fakeSend();
  await run(send);
  assert.deepEqual(sent.map((email) => email.to), ["other@example.com"]);
});
