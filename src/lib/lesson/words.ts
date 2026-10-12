import { createHash } from "node:crypto";
import { and, arrayContains, eq, isNull, or } from "drizzle-orm";
import { wordClip } from "@/lib/audio-key";
import { makeVerifiedClip } from "@/lib/audio-store";
import { db } from "@/lib/db";
import { knowledge, lexemes, sentences, themes } from "@/lib/db/schema";
import { normalizeForCompare, normalizePersian } from "@/lib/normalize";
import { topUpSentences } from "./generate";
import type { Lexeme, Person } from "./types";

/** A word the learner met outside the app, as they confirmed it. */
export type WordEntry = {
  fa: string;
  voc: string;
  translit: string;
  gloss: string;
  literary: string | null;
  lemma: string | null;
  verbPerson: Person | null;
  subjectPronoun: Person | null;
  note: string | null;
};

const myWordsThemeId = (userId: string) => `my-words-${userId}`;
const PERSIAN = /^[؀-ۿ‌\s]+$/;

/** Problems that stop an entry being saved. Empty = fine. */
export function validateWord(entry: WordEntry): string[] {
  const problems: string[] = [];
  if (!entry.fa.trim() || !PERSIAN.test(entry.fa)) problems.push("The Persian word must be in Persian script.");
  if (!entry.translit.trim()) problems.push("The pronunciation is missing.");
  if (!entry.gloss.trim()) problems.push("The meaning is missing.");
  if (entry.voc.trim() && normalizePersian(entry.voc) !== normalizePersian(entry.fa)) {
    problems.push("The vowelled spelling must be the same letters as the plain spelling, with vowel marks added.");
  }
  return problems;
}

/** The word already in this learner's reference with the same spelling, if any. */
export async function findExisting(userId: string, fa: string) {
  const visible = await db
    .select({ id: lexemes.id, fa: lexemes.fa, gloss: lexemes.gloss })
    .from(lexemes)
    .where(or(isNull(lexemes.ownerId), eq(lexemes.ownerId, userId)));
  const wanted = normalizeForCompare(fa);
  return visible.find((l) => normalizeForCompare(l.fa) === wanted) ?? null;
}

export const ownedWordId = (userId: string, fa: string) =>
  `own-${createHash("sha256").update(`${userId}\n${normalizeForCompare(fa)}`).digest("hex").slice(0, 12)}`;

/** The lexeme row an entry becomes. Pure, so a draft can be assembled into sentences before anything is stored. */
export function ownedLexeme(userId: string, entry: WordEntry, addedBy: "learner" | "app"): Lexeme {
  const fa = entry.fa.trim();
  return {
    id: ownedWordId(userId, fa),
    fa,
    voc: entry.voc.trim() || fa,
    translit: entry.translit.trim().toLowerCase(),
    gloss: entry.gloss.trim(),
    literary: entry.literary?.trim() || null,
    lemma: entry.lemma?.trim() || null,
    verbPerson: entry.verbPerson,
    subjectPronoun: entry.subjectPronoun,
    note: entry.note?.trim() || null,
    ownerId: userId,
    addedBy,
  };
}

/** Creates one of a learner's personal themes if it is not there yet. */
export async function ensureTheme(theme: typeof themes.$inferInsert): Promise<void> {
  await db.insert(themes).values(theme).onConflictDoNothing();
}

/**
 * Saves a word the learner typed in. It joins their "My words" theme as a
 * one-word sentence, so it is introduced and scheduled exactly like a curated
 * word. Returns the new lexeme id.
 */
export async function addWord(userId: string, entry: WordEntry): Promise<string> {
  const word = ownedLexeme(userId, entry, "learner");
  const themeId = myWordsThemeId(userId);
  await ensureTheme({
    id: themeId,
    title: "My words",
    titleFa: "کلمه‌های من",
    description: "Words you met outside the app and added yourself.",
    position: -1,
    ownerId: userId,
  });
  await db.insert(lexemes).values(word);
  await db.insert(sentences).values({
    id: `${word.id}-s`,
    themeId,
    // Newest last; seconds keep it inside a 32-bit integer.
    position: Math.floor(Date.now() / 1000),
    english: `${word.gloss.charAt(0).toUpperCase()}${word.gloss.slice(1)}.`,
    note: null,
    tokens: [{ lexemeId: word.id, fa: word.fa, voc: word.voc, translit: word.translit }],
    endPunct: ".",
    lexemeIds: [word.id],
    patternIds: [],
  });
  return word.id;
}

/** The slow follow-up to adding a word: its audio, and sentences that use it. Run after the response. */
export async function prepareWord(userId: string, lexemeId: string): Promise<void> {
  const word = await db.query.lexemes.findFirst({ where: and(eq(lexemes.id, lexemeId), eq(lexemes.ownerId, userId)) });
  if (!word) return;
  await makeVerifiedClip(wordClip(word));
  await topUpSentences(userId, { force: true, focus: [lexemeId], count: 4 });
}

/** Removes one of the learner's own words, with its sentences and their progress on it. */
export async function removeWord(userId: string, lexemeId: string): Promise<boolean> {
  const removed = await db
    .delete(lexemes)
    .where(and(eq(lexemes.id, lexemeId), eq(lexemes.ownerId, userId)))
    .returning({ id: lexemes.id });
  if (removed.length === 0) return false;
  await Promise.all([
    db.delete(sentences).where(arrayContains(sentences.lexemeIds, [lexemeId])),
    db.delete(knowledge).where(and(eq(knowledge.userId, userId), eq(knowledge.kind, "lexeme"), eq(knowledge.refId, lexemeId))),
  ]);
  return true;
}
