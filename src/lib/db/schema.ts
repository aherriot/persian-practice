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

// --- App tables ---

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
