// Persian Practice data model. Auth.js (NextAuth) owns User/Account/Session/
// VerificationToken via @auth/drizzle-adapter — those four follow the adapter's
// canonical column shape (see ../../../../readtrip/lib/db/schema.ts, the
// pattern this file replicates). Everything else is app-owned.
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { Person, Skill } from "@/lib/lesson/types";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  timestamp("createdAt", { precision: 3 }).defaultNow().notNull();

// For timestamp columns that aren't literally named "createdAt" — keeps the SQL
// column name matching the Drizzle key instead of silently reusing "createdAt".
const timestampDefaultNow = (column: string) =>
  timestamp(column, { precision: 3 }).defaultNow().notNull();

// --- Auth.js (NextAuth) adapter tables ---

export const users = pgTable("User", {
  id: id(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { precision: 3, mode: "date" }),
  image: text("image"),
  // The daily reminder email (src/lib/reminders.ts). Off until the learner asks for it.
  reminders: boolean("reminders").notNull().default(false),
  // IANA zone, e.g. "America/Toronto", taken from the browser when reminders
  // are turned on: "has not practised today" means the learner's own day.
  timeZone: text("timeZone"),
  lastRemindedAt: timestamp("lastRemindedAt", { precision: 3 }),
  createdAt: createdAt(),
});

export const accounts = pgTable(
  "Account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable("Session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { precision: 3, mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "VerificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { precision: 3, mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

// --- Lesson engine tables ---
//
// Content (themes, lexemes, patterns, sentences) uses readable slug ids so the
// curated seed in src/lib/content can be upserted idempotently. Lexemes a
// learner adds themselves get a UUID and an ownerId.

export type SentenceToken = {
  lexemeId: string;
  fa: string; // plain spelling, as a native reader sees it
  voc: string; // same word with short-vowel marks
  translit: string;
  /** Punctuation that follows this word inside the sentence, e.g. "،". */
  after?: string;
};

export const themes = pgTable("Theme", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  titleFa: text("titleFa").notNull(),
  description: text("description").notNull(),
  position: integer("position").notNull(),
  // Set on a learner's own "My words" theme; null = curated, visible to everyone.
  ownerId: text("ownerId").references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

// A unit the learner knows as a whole: a word, an inflected verb form, or a
// fixed phrase. `fa` is always the spoken Tehrani form.
export const lexemes = pgTable("Lexeme", {
  id: text("id").primaryKey(),
  fa: text("fa").notNull(),
  voc: text("voc").notNull(),
  translit: text("translit").notNull(),
  gloss: text("gloss").notNull(),
  lemma: text("lemma"), // dictionary form that groups inflections, e.g. داشتن
  literary: text("literary"), // written/book counterpart, when it differs
  note: text("note"),
  // Grammatical person, e.g. "1pl": on a subject pronoun, and on a verb form.
  // Lets an answer with or without an agreeing pronoun count as correct.
  subjectPronoun: text("subjectPronoun").$type<Person>(),
  verbPerson: text("verbPerson").$type<Person>(),
  ownerId: text("ownerId").references(() => users.id, { onDelete: "cascade" }), // null = curated
  // For an owned word: typed in by the learner, or chosen for them by the
  // expansion author once they ran out of curated material.
  addedBy: text("addedBy").$type<"learner" | "app">(),
  createdAt: createdAt(),
});

// Grammar that has no word of its own (negation, ezafe, question intonation…).
export const patterns = pgTable("Pattern", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  position: integer("position").notNull(),
  createdAt: createdAt(),
});

export const sentences = pgTable(
  "Sentence",
  {
    id: text("id").primaryKey(),
    // Null for generated sentences, which mix words from any theme.
    themeId: text("themeId").references(() => themes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(), // place on the theme's ladder
    english: text("english").notNull(),
    note: text("note"),
    tokens: jsonb("tokens").$type<SentenceToken[]>().notNull(),
    endPunct: text("endPunct").notNull(),
    // Denormalised from tokens so "which sentences use X" needs no JSON digging.
    lexemeIds: text("lexemeIds").array().notNull(),
    patternIds: text("patternIds").array().notNull().default([]),
    // Written by the LLM author (src/lib/lesson/generate.ts), not by hand.
    generated: boolean("generated").notNull().default(false),
    // On the ladder: may be used to introduce its one new word or pattern.
    // Off it, a sentence only ever practises things already known.
    ladder: boolean("ladder").notNull().default(true),
    // Reported as wrong by a learner; never shown again.
    retired: boolean("retired").notNull().default(false),
    // The sentences this one is a natural reply to ("How are you?" for "I'm well, thanks."), by id.
    replyTo: text("replyTo").array().notNull().default([]),
    // The learner it was written for; null for curated sentences, which everyone shares.
    ownerId: text("ownerId").references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.themeId, t.position),
    index().on(t.ownerId),
    // "Which sentences use X", for the reference's examples.
    index().using("gin", t.lexemeIds),
    index().using("gin", t.patternIds),
  ],
);

// FSRS state (src/lib/srs.ts), one row per (user, lexeme or pattern, skill). Sentences
// are not scheduled; they are the vehicle that exercises these.
export const knowledge = pgTable(
  "Knowledge",
  {
    id: id(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"lexeme" | "pattern">().notNull(),
    refId: text("refId").notNull(),
    // Listening, reading and producing are scheduled apart: one row for each.
    skill: text("skill").$type<Skill>().notNull(),
    // Days for recall to fall to 90%, and how hard the item is (1–10). Both
    // zero until it has been answered once.
    stability: real("stability").notNull().default(0),
    difficulty: real("difficulty").notNull().default(0),
    intervalDays: real("intervalDays").notNull().default(0),
    repetitions: integer("repetitions").notNull().default(0), // right answers in a row
    lapses: integer("lapses").notNull().default(0), // wrong answers ever
    dueAt: timestamp("dueAt", { precision: 3 }).notNull(),
    lastReviewedAt: timestamp("lastReviewedAt", { precision: 3 }),
    introducedAt: timestampDefaultNow("introducedAt"),
  },
  (t) => [unique().on(t.userId, t.kind, t.refId, t.skill), index().on(t.userId, t.dueAt)],
);

export const reviewLog = pgTable(
  "ReviewLog",
  {
    id: id(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sentenceId: text("sentenceId"),
    exercise: text("exercise").notNull(),
    correct: boolean("correct").notNull(),
    // What the exercise was testing, as "lexeme:<id>" or "pattern:<id>"; null for ungraded practice.
    target: text("target"),
    // The wrong answer given: the option picked, or the words built in order. Null when right.
    picked: text("picked"),
    // Made up by the browser, one per answer, and sent again with every retry:
    // an answer that arrives twice is recorded once. Null on rows from before this.
    key: text("key").unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.userId, t.createdAt),
    // "How often has this learner answered this sentence."
    index().on(t.userId, t.sentenceId),
  ],
);

// What each synthesised clip should say, keyed by a hash of (text, expected
// reading, voice). The mp3 itself lives in the blob store. The remaining
// columns record how the stored audio was made and whether the automated
// listener accepted it (src/lib/audio-store.ts); `status` is null until then.
export const audioClips = pgTable("AudioClip", {
  hash: text("hash").primaryKey(),
  text: text("text").notNull(),
  // Space-separated transliteration the audio must match.
  expected: text("expected").notNull(),
  status: text("status").$type<"verified" | "flagged">(),
  // What the listener heard in the stored audio.
  heard: text("heard"),
  // The instruction that produced the stored audio.
  instructions: text("instructions"),
  // The text the speech model was given for the stored audio, where it was not `text`.
  spoken: text("spoken"),
  attempts: integer("attempts"),
  // Set when the stored audio is a whole sentence the word is in ("havij o sib
  // dârim") because the word could not be said alone: that sentence's transliteration.
  carrier: text("carrier"),
  // Set when a person has listened and approved the stored audio. An approved
  // clip is pinned: nothing automated replaces it.
  approvedAt: timestamp("approvedAt", { precision: 3 }),
  createdAt: createdAt(),
});

// A person's verdict on one take of a clip. The automated listener cannot hear
// accent (FINDINGS §14), so these are the only accent labels there are. A
// rejected take's audio is kept at reviewed/<id>.mp3 as a labelled bad example;
// an approved take is the clip's own stored audio.
export const audioReviews = pgTable(
  "AudioReview",
  {
    id: id(),
    hash: text("hash")
      .notNull()
      .references(() => audioClips.hash, { onDelete: "cascade" }),
    verdict: text("verdict").$type<"approved" | "rejected">().notNull(),
    reason: text("reason").$type<"word" | "accent" | "pause" | "other">(),
    note: text("note"),
    // How the judged take was made, and what the listener had said about it.
    instructions: text("instructions"),
    heard: text("heard"),
    listenerStatus: text("listenerStatus").$type<"verified" | "flagged">(),
    userId: text("userId").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.hash)],
);

// A change a person made to a word or a sentence from inside the app, by
// describing what was wrong (src/lib/lesson/correct.ts). The row itself has
// already been changed; this is the record of it, and what `npm run db:seed`
// replays so that seeding the curated content again does not undo the fix.
export type CorrectionChanges = Record<string, { from: unknown; to: unknown }>;

export const corrections = pgTable(
  "Correction",
  {
    id: id(),
    kind: text("kind").$type<"lexeme" | "sentence">().notNull(),
    refId: text("refId").notNull(),
    // What the person wrote, and the one-line account of the fix they agreed to.
    request: text("request").notNull(),
    summary: text("summary").notNull(),
    // Each field that changed, as it was and as it is now.
    changes: jsonb("changes").$type<CorrectionChanges>().notNull(),
    userId: text("userId").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.kind, t.refId)],
);

// Something a person has said is wrong with a word or a sentence, waiting for
// someone to fix it or to decide nothing is (src/lib/lesson/flags.ts). Fixing
// the thing resolves every open flag on it.
export const flags = pgTable(
  "Flag",
  {
    id: id(),
    kind: text("kind").$type<"lexeme" | "sentence">().notNull(),
    refId: text("refId").notNull(),
    note: text("note").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolvedAt", { precision: 3 }),
    outcome: text("outcome").$type<"fixed" | "dismissed">(),
  },
  (t) => [index().on(t.kind, t.refId)],
);

// --- Background work ---
//
// Slow work done for a learner outside any request: writing new sentences and
// making their audio (src/lib/lesson/background.ts). A job is done in small
// steps, and `state` is saved after each, so a worker that is cut off loses
// one step and the next worker carries on from there (src/lib/jobs/queue.ts).

export type JobKind = "session" | "word";

export const jobs = pgTable(
  "Job",
  {
    id: id(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<JobKind>().notNull(),
    // What the job is about. Only one unfinished job may have a given key, so
    // asking twice for the same work queues it once.
    key: text("key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    // How far the job has got; null until its first step is done.
    state: jsonb("state").$type<unknown>(),
    status: text("status").$type<"pending" | "done" | "failed">().notNull().default("pending"),
    // Steps started in a row without one finishing. Reset by every finished step.
    attempts: integer("attempts").notNull().default(0),
    // Not before this: pushed into the future after a failure.
    runAfter: timestampDefaultNow("runAfter"),
    // The worker holding the job, and until when. A lease that has run out is
    // anyone's to take: its worker was cut off.
    leaseId: text("leaseId"),
    leaseUntil: timestamp("leaseUntil", { precision: 3 }),
    lastError: text("lastError"),
    createdAt: createdAt(),
    finishedAt: timestamp("finishedAt", { precision: 3 }),
  },
  (t) => [uniqueIndex().on(t.key).where(sql`"status" = 'pending'`), index().on(t.status, t.runAfter)],
);
