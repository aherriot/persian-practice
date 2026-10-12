// Persian Practice data model. Auth.js (NextAuth) owns User/Account/Session/
// VerificationToken via @auth/drizzle-adapter — those four follow the adapter's
// canonical column shape (see ../../../../readtrip/lib/db/schema.ts, the
// pattern this file replicates). Everything else is app-owned.
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { Person } from "@/lib/lesson/types";

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
  level: text("level"), // resolved placement level, e.g. "A1".."C1" — null until placed
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
    themeId: text("themeId")
      .notNull()
      .references(() => themes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(), // place on the theme's ladder
    english: text("english").notNull(),
    note: text("note"),
    tokens: jsonb("tokens").$type<SentenceToken[]>().notNull(),
    endPunct: text("endPunct").notNull(),
    // Denormalised from tokens so "which sentences use X" needs no JSON digging.
    lexemeIds: text("lexemeIds").array().notNull(),
    patternIds: text("patternIds").array().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.themeId, t.position)],
);

// SM-2 state, one row per (user, lexeme or pattern). Sentences are not
// scheduled; they are the vehicle that exercises these.
export const knowledge = pgTable(
  "Knowledge",
  {
    id: id(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"lexeme" | "pattern">().notNull(),
    refId: text("refId").notNull(),
    intervalDays: real("intervalDays").notNull().default(0),
    easeFactor: real("easeFactor").notNull().default(2.5),
    repetitions: integer("repetitions").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    dueAt: timestamp("dueAt", { precision: 3 }).notNull(),
    lastReviewedAt: timestamp("lastReviewedAt", { precision: 3 }),
    introducedAt: timestampDefaultNow("introducedAt"),
  },
  (t) => [unique().on(t.userId, t.kind, t.refId), index().on(t.userId, t.dueAt)],
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
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.createdAt)],
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
  attempts: integer("attempts"),
  createdAt: createdAt(),
});

// --- Legacy tables (conversation-v1) ---
//
// Used only by the parked code in research/conversation-v1. Kept here so the
// next migration does not drop them; remove once that data is no longer wanted.

// The vocabulary/grammar item bank. Shared across users, not per-user.
export const items = pgTable("Item", {
  id: id(),
  type: text("type").$type<"vocab" | "grammar" | "phrase">().notNull(),
  persian: text("persian").notNull(), // colloquial spoken form, e.g. می‌رم
  literary: text("literary"), // literary counterpart, if relevant
  gloss: text("gloss").notNull(), // English meaning
  transliteration: text("transliteration"),
  tier: integer("tier").notNull(), // placement difficulty ladder, 1..N
  tags: text("tags").array().notNull().default([]),
  createdAt: createdAt(),
});

// SM-2 state, one row per (user, item).
export const userItems = pgTable(
  "UserItem",
  {
    id: id(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: text("itemId")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    intervalDays: real("intervalDays").notNull().default(0),
    easeFactor: real("easeFactor").notNull().default(2.5),
    repetitions: integer("repetitions").notNull().default(0),
    dueAt: date("dueAt").notNull(),
    lapses: integer("lapses").notNull().default(0),
    lastReviewedAt: timestamp("lastReviewedAt", { precision: 3 }),
    introducedAt: timestampDefaultNow("introducedAt"),
    source: text("source").$type<"placement" | "conversation" | "manual">().notNull(),
  },
  (t) => [unique().on(t.userId, t.itemId), index().on(t.userId, t.dueAt)],
);

// Free-text, user-declared topics — the "tie practice to real life" mechanism.
export const topics = pgTable("Topic", {
  id: id(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  rawText: text("rawText").notNull(),
  summary: text("summary"), // LLM-normalized short label
  tags: text("tags").array().notNull().default([]),
  createdAt: createdAt(),
  lastUsedAt: timestamp("lastUsedAt", { precision: 3 }).defaultNow().notNull(),
});

export const conversations = pgTable("Conversation", {
  id: id(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  topicId: text("topicId").references(() => topics.id, { onDelete: "set null" }),
  mode: text("mode").$type<"topic" | "review" | "placement">().notNull(),
  // Generated once at conversation start from the free-text topic, then reused
  // every turn — regenerating it per turn would waste tokens and drift.
  scenario: jsonb("scenario").$type<{
    id: string;
    title: string;
    goal: string;
    situation: string;
    opener: string;
    openerTransliteration: string;
  }>(),
  startedAt: timestampDefaultNow("startedAt"),
  endedAt: timestamp("endedAt", { precision: 3 }),
});

export const turns = pgTable(
  "Turn",
  {
    id: id(),
    conversationId: text("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    // Latin transliteration, assistant turns only — shown on demand for a
    // learner struggling to read the script, so it doesn't need recomputing.
    transliteration: text("transliteration"),
    seq: integer("seq").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.conversationId, t.seq)],
);

// Links a turn to an item + what happened — the SM-2 update trigger.
export const corrections = pgTable("Correction", {
  id: id(),
  turnId: text("turnId")
    .notNull()
    .references(() => turns.id, { onDelete: "cascade" }),
  itemId: text("itemId")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  outcome: text("outcome").$type<"correct" | "recast" | "unknown">().notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

export const placementSessions = pgTable("PlacementSession", {
  id: id(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").$type<"in_progress" | "complete" | "abandoned">().notNull(),
  currentTier: integer("currentTier").notNull(),
  lowTier: integer("lowTier").notNull(),
  highTier: integer("highTier").notNull(),
  exchangeCount: integer("exchangeCount").notNull().default(0),
  resultLevel: text("resultLevel"),
  createdAt: createdAt(),
  completedAt: timestamp("completedAt", { precision: 3 }),
});

export const placementResponses = pgTable("PlacementResponse", {
  id: id(),
  placementSessionId: text("placementSessionId")
    .notNull()
    .references(() => placementSessions.id, { onDelete: "cascade" }),
  itemId: text("itemId").references(() => items.id, { onDelete: "set null" }),
  tier: integer("tier").notNull(),
  correct: boolean("correct").notNull(),
  seq: integer("seq").notNull(),
});
