import { eq, sql } from "drizzle-orm";
import { wordClip } from "@/lib/audio-key";
import { makeVerifiedClip } from "@/lib/audio-store";
import { db } from "@/lib/db";
import { lexemes, sentences } from "@/lib/db/schema";
import { normalizeForCompare } from "@/lib/normalize";
import { assembleSentence, type Assembled } from "./assemble";
import { draftExpansion, draftPatternSentences, NEW_WORD } from "./author";
import { reviewCandidates, type Candidate, type Draft, type Rejection } from "./drafts";
import { FORM_PATTERN, formsFor, GRAMMAR_SPINE } from "./forms";
import { generatedToday, GLOBAL_DAILY_CAP } from "./generate";
import { loadStretch } from "./history";
import { newPerSession } from "./pace";
import { sentenceClip, sentenceText } from "./plan";
import { isReadyForMore, measureProgress } from "./progress";
import { loadCourse, loadKnowledge, loadSameWords, loadWordUses } from "./store";
import type { Lexeme } from "./types";
import { WORKING_VOCABULARY, workingVocabulary } from "./vocabulary";
import { ensureTheme, ownedLexeme, validateWord } from "./words";

/** New material is written when fewer than this many unmet words and patterns are left… */
export const FRONTIER = 4;
/** …or, for a learner taking it fast (pace.ts), enough for two of their sessions. */
export const frontierFor = (stretch: number) => Math.max(FRONTIER, 2 * newPerSession(stretch));
/**
 * …and the learner is getting no more than this many of the things they have
 * met wrong. This is the only brake: a learner who answers everything
 * correctly gets new material as fast as they use it up, and mistakes hold it
 * back until they are put right. There is no limit per learner per day; only
 * the ceiling on everything generated for everyone (GLOBAL_DAILY_CAP).
 */
export const MAX_SHAKY = 3;
/** Words asked for at a time, up to twice as many for a learner at full stretch. */
const NEW_WORDS = 5;
const PATTERN_SENTENCES = 3;
/** Words that can take a new piece of grammar, guaranteed a place in front of the author teaching it. */
const FORM_WORDS = 30;

export type ExpandResult = {
  skipped?: string;
  added: { text: string; english: string; teaches: string }[];
  rejected: Rejection[];
};

const goingFurtherId = (userId: string) => `going-further-${userId}`;
const plainText = (s: Pick<Assembled, "tokens">) => normalizeForCompare(s.tokens.map((t) => t.fa).join(" "));

/**
 * Drafts something new for a learner who is running out of material: the next
 * piece of grammar from the spine if they are ready for it, and new words
 * chosen to open up new kinds of sentence. Nothing is stored.
 */
export async function draftFrontier(userId: string, opts: { force?: boolean } = {}): Promise<Draft> {
  const result: Draft = { candidates: [], rejected: [] };
  const [content, knowledge, stretch] = await Promise.all([loadCourse(userId), loadKnowledge(userId), loadStretch(userId, new Date())]);
  const progress = measureProgress(content.onLadder, knowledge);
  if (!opts.force) {
    if (progress.remaining >= frontierFor(stretch)) return { ...result, skipped: `${progress.remaining} things still to learn` };
    if (!isReadyForMore(progress, MAX_SHAKY)) return { ...result, skipped: "still consolidating what is known" };
  }
  if ((await generatedToday()) >= GLOBAL_DAILY_CAP) return { ...result, skipped: "daily limit reached" };

  const known = [...content.lexemes.values()].filter((l) => knowledge.has(`lexeme:${l.id}`));
  const upcoming = [...content.lexemes.values()].filter((l) => !knowledge.has(`lexeme:${l.id}`));
  const patterns = new Set([...content.patterns.keys()].filter((id) => knowledge.has(`pattern:${id}`)));
  // The authors write with a working part of a large vocabulary, not all of it.
  const uses = known.length > WORKING_VOCABULARY ? await loadWordUses(userId) : new Map<string, number>();
  const mostUsed = (words: Lexeme[]) => [...words].sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0));

  const considered: Candidate[] = [];
  const consider = (candidate: Candidate) => considered.push(candidate);

  // --- Grammar: the next spine pattern, unless one is already waiting on the ladder. ---
  const next = GRAMMAR_SPINE.find((p) => !patterns.has(p.id));
  if (next && !content.onLadder.has(`pattern:${next.id}`) && content.patterns.has(next.id)) {
    const takesForm = mostUsed(known.filter((l) => formsFor(l).includes(next.form))).slice(0, FORM_WORDS);
    const shown = workingVocabulary(known, { must: takesForm.map((l) => l.id), uses });
    const drafts = await draftPatternSentences(next, shown, patterns, PATTERN_SENTENCES);
    const allowed = { lexemes: new Set(known.map((l) => l.id)), patterns: new Set([...patterns, next.id]) };
    for (const draft of drafts) {
      const built = assembleSentence(draft, content.lexemes, allowed);
      if (!built.ok) result.rejected.push({ text: draft.english, reason: built.reason });
      else if (!built.sentence.patternIds.includes(next.id)) result.rejected.push({ text: sentenceText(built.sentence), reason: "does not use the new grammar" });
      else consider({ sentence: built.sentence, teaches: next.title, word: null });
    }
  }

  // --- Vocabulary. ---
  const shown = workingVocabulary(known, { uses });
  const drafts = await draftExpansion({
    known: shown,
    alsoKnown: known.length > shown.length ? known.filter((l) => !shown.includes(l)) : [],
    upcoming,
    patterns,
    interests: [
      ...new Set([
        ...(await curatedThemeTitles()),
        ...[...content.lexemes.values()].filter((l) => l.addedBy === "learner").map((l) => l.gloss),
      ]),
    ],
    count: NEW_WORDS + Math.round(stretch * NEW_WORDS),
  });
  const spellings = new Set([...content.lexemes.values()].map((l) => normalizeForCompare(l.fa)));
  for (const { sentence: draft, ...entry } of drafts) {
    const label = `${entry.fa} (${entry.gloss})`;
    const problems = validateWord(entry);
    if (problems.length > 0) {
      result.rejected.push({ text: label, reason: problems.join(" ") });
      continue;
    }
    if (spellings.has(normalizeForCompare(entry.fa))) {
      result.rejected.push({ text: label, reason: "already in the course" });
      continue;
    }
    const word = ownedLexeme(userId, entry, "app");
    if (draft.tokens.filter((t) => t.word === NEW_WORD).length !== 1) {
      result.rejected.push({ text: label, reason: "sentence does not use the new word exactly once" });
      continue;
    }
    const built = assembleSentence(
      { ...draft, tokens: draft.tokens.map((t) => (t.word === NEW_WORD ? { ...t, word: word.id, form: "base" as const } : t)) },
      new Map([...content.lexemes, [word.id, word]]),
      { lexemes: new Set([...known.map((l) => l.id), word.id]), patterns },
    );
    if (!built.ok) {
      result.rejected.push({ text: label, reason: built.reason });
      continue;
    }
    spellings.add(normalizeForCompare(entry.fa));
    consider({ sentence: built.sentence, teaches: `${word.fa} — ${word.translit} — ${word.gloss}`, word });
  }

  // --- Nothing the learner already has, nor the same thing twice. ---
  const taken = new Set((await loadSameWords(userId, considered.map((c) => c.sentence.lexemeIds))).map(plainText));
  const candidates: Candidate[] = [];
  for (const candidate of considered) {
    const text = plainText(candidate.sentence);
    if (taken.has(text)) {
      result.rejected.push({ text: sentenceText(candidate.sentence), reason: "already exists" });
      continue;
    }
    taken.add(text);
    candidates.push(candidate);
  }
  result.candidates = candidates;
  return result;
}

/**
 * Gives a reviewed sentence (and the new word it teaches, if any) its audio
 * and stores it at the end of the learner's personal "Going further" theme on
 * the ladder, so it is introduced one item at a time like curated content.
 * Returns the sentence's text, or why it was dropped. `makeClip` is
 * replaceable in tests.
 */
export async function storeFrontier(
  userId: string,
  { sentence, word }: Candidate,
  makeClip = makeVerifiedClip,
): Promise<{ added: string } | { rejected: Rejection }> {
  const text = sentenceText(sentence);
  const audioOk = (!word || (await makeClip(wordClip(word)))) && (await makeClip(sentenceClip(sentence)));
  if (!audioOk) return { rejected: { text, reason: "audio did not pass the listener" } };

  const themeId = goingFurtherId(userId);
  await ensureTheme({
    id: themeId,
    title: "Going further",
    titleFa: "قدم بعدی",
    description: "New words and grammar the app has added for you, now that you know the rest.",
    position: 1000,
    ownerId: userId,
  });
  const [{ last }] = await db
    .select({ last: sql<number>`coalesce(max(${sentences.position}), 0)::int` })
    .from(sentences)
    .where(eq(sentences.themeId, themeId));
  if (word) await db.insert(lexemes).values(word).onConflictDoNothing();
  await db
    .insert(sentences)
    .values({
      ...sentence,
      id: `${themeId}-${last + 1}`,
      themeId,
      ownerId: userId,
      position: last + 1,
      note: null,
      generated: true,
      ladder: true,
    })
    .onConflictDoNothing();
  return { added: text };
}

/**
 * Expands a learner's course in one go: draft, second opinion, audio, store.
 * The app does the same thing a step at a time from its job queue
 * (src/lib/lesson/background.ts); this is for scripts.
 *
 * `dryRun` drafts and checks but makes no audio and stores nothing.
 */
export async function expandFrontier(
  userId: string,
  opts: { force?: boolean; dryRun?: boolean } = {},
): Promise<ExpandResult> {
  const draft = await draftFrontier(userId, opts);
  const review = await reviewCandidates(draft.candidates);
  const result: ExpandResult = { skipped: draft.skipped, added: [], rejected: [...draft.rejected, ...review.rejected] };
  for (const candidate of review.kept) {
    const stored = opts.dryRun ? null : await storeFrontier(userId, candidate);
    if (stored && "rejected" in stored) result.rejected.push(stored.rejected);
    else result.added.push({ text: sentenceText(candidate.sentence), english: candidate.sentence.english, teaches: candidate.teaches ?? "" });
  }
  return result;
}

async function curatedThemeTitles(): Promise<string[]> {
  const rows = await db.query.themes.findMany({ columns: { title: true, ownerId: true } });
  return rows.filter((t) => t.ownerId === null).map((t) => t.title);
}

// FORM_PATTERN is the contract between spine entries and forms; fail loudly at import if they drift.
for (const entry of GRAMMAR_SPINE) {
  if (FORM_PATTERN[entry.form] !== entry.id) throw new Error(`grammar spine: form "${entry.form}" does not produce pattern "${entry.id}"`);
}
