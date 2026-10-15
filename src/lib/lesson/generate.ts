import { createHash } from "node:crypto";
import { and, desc, eq, gt, notExists, sql } from "drizzle-orm";
import { makeVerifiedClip } from "@/lib/audio-store";
import { db } from "@/lib/db";
import { lexemes, reviewLog, sentences } from "@/lib/db/schema";
import { normalizeForCompare } from "@/lib/normalize";
import { assembleSentence, type Assembled } from "./assemble";
import { draftSentences } from "./author";
import { reviewCandidates, type Candidate, type Draft, type Rejection } from "./drafts";
import { dropRepeats } from "./repeats";
import { sentenceClip, sentenceText } from "./plan";
import { isFluent, measureProgress } from "./progress";
import { allIn, knownIds, loadCourse, loadKnowledge, loadWordUses, textArray, visibleSentence } from "./store";
import type { Sentence } from "./types";
import { workingVocabulary } from "./vocabulary";

/** Below this many unseen generated sentences, more are written. */
const MIN_UNSEEN = 6;
const BATCH = 8;
/** Words the batch is built around: the ones with the fewest sentences to practise them in. */
const FOCUS_WORDS = 6;
/** Practice sentences written for one learner per rolling day. */
export const LEARNER_DAILY_CAP = 24;
/**
 * Hard ceiling on spending: generated sentences of every kind stored per
 * rolling day, across everyone. Far above what the learners' own limits add
 * up to today; it is there for the day something loops.
 */
export const GLOBAL_DAILY_CAP = 240;
/** Share of known words that must be well established before sentences get longer and denser. */
const STRETCH_SHARE = 0.6;
/** Too few words make only strange sentences. */
const MIN_WORDS = 5;
/** How many existing sentences the author is shown so as not to repeat them. */
const SHOWN_EXISTING = 80;

export type TopUpOptions = {
  /** Write even if the learner has plenty of unseen sentences. */
  force?: boolean;
  count?: number;
  /** The words every sentence must feature. */
  focus?: string[];
};

export type TopUpResult = {
  /** Why nothing was generated, if nothing was. */
  skipped?: string;
  added: Sentence[];
  rejected: Rejection[];
};

const plainText = (s: Pick<Sentence, "tokens">) => normalizeForCompare(s.tokens.map((t) => t.fa).join(" "));
const generatedId = (userId: string, s: Assembled) =>
  `gen-${createHash("sha256").update(`${userId}\n${plainText(s)}${s.endPunct}`).digest("hex").slice(0, 16)}`;

/**
 * Sentences the learner could be given now: made of words they know, or added
 * themselves and are about to meet, and grammar they know.
 */
const usable = (userId: string) =>
  and(
    visibleSentence(userId),
    allIn(
      sentences.lexemeIds,
      sql`(select * from ${knownIds(userId, "lexeme")} as met union select ${lexemes.id} from ${lexemes} where ${lexemes.ownerId} = ${userId})`,
    ),
    allIn(sentences.patternIds, knownIds(userId, "pattern")),
  )!;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Generated sentences stored in the last day, for everyone and of every kind. */
export async function generatedToday(now = new Date()): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sentences)
    .where(and(eq(sentences.generated, true), gt(sentences.createdAt, new Date(now.getTime() - DAY_MS))));
  return n;
}

/**
 * How many more practice sentences may be written for a learner now: what is
 * left of their own day's allowance, or of everyone's if that is less.
 */
export async function practiceAllowance(userId: string, now = new Date()): Promise<number> {
  const [[{ mine }], everyone] = await Promise.all([
    db
      .select({ mine: sql<number>`count(*)::int` })
      .from(sentences)
      .where(
        and(
          eq(sentences.ownerId, userId),
          eq(sentences.generated, true),
          eq(sentences.ladder, false),
          gt(sentences.createdAt, new Date(now.getTime() - DAY_MS)),
        ),
      ),
    generatedToday(now),
  ]);
  return Math.max(0, Math.min(LEARNER_DAILY_CAP - mine, GLOBAL_DAILY_CAP - everyone));
}

/**
 * Drafts new practice sentences from the words a learner already knows, if
 * they are running short of ones they have not seen: the author's draft, built
 * mechanically into sentences, less any the learner already has. Nothing is
 * stored. `author` is the call that writes them, replaceable in tests.
 */
export async function draftPractice(userId: string, opts: TopUpOptions = {}, author = draftSentences): Promise<Draft> {
  const skip = (skipped: string): Draft => ({ skipped, candidates: [], rejected: [] });
  const [content, knowledge] = await Promise.all([loadCourse(userId), loadKnowledge(userId)]);

  // Known words, plus the learner's own words that are still waiting to be
  // introduced, so those have sentences ready the moment they are.
  const words = [...content.lexemes.values()].filter((l) => knowledge.has(`lexeme:${l.id}`) || l.ownerId === userId);
  if (words.length < MIN_WORDS) return skip("too few words known");
  const allowed = {
    lexemes: new Set(words.map((l) => l.id)),
    patterns: new Set([...content.patterns.keys()].filter((id) => knowledge.has(`pattern:${id}`))),
  };

  const answered = db
    .select({ id: reviewLog.id })
    .from(reviewLog)
    .where(and(eq(reviewLog.userId, userId), eq(reviewLog.sentenceId, sentences.id)));
  const [{ unseen }] = await db
    .select({ unseen: sql<number>`count(*)::int` })
    .from(sentences)
    .where(and(usable(userId), eq(sentences.generated, true), notExists(answered)));
  if (!opts.force && unseen >= MIN_UNSEEN) return skip("enough unseen sentences");

  const allowance = await practiceAllowance(userId);
  if (allowance === 0) return skip("daily limit reached");

  const uses = await loadWordUses(userId, usable(userId));
  // Unless told otherwise, write about the words with the fewest sentences to practise them in.
  const focus =
    opts.focus ?? [...allowed.lexemes].sort((a, b) => (uses.get(a) ?? 0) - (uses.get(b) ?? 0)).slice(0, FOCUS_WORDS);
  // The author sees what already exists for the words it is writing about, newest first.
  const existing = await db
    .select()
    .from(sentences)
    .where(and(usable(userId), sql`${sentences.lexemeIds} && ${textArray(focus)}`))
    .orderBy(desc(sentences.createdAt))
    .limit(SHOWN_EXISTING);

  const drafts = await author({
    words: workingVocabulary(words, { must: focus, uses }),
    patterns: allowed.patterns,
    focus,
    existing: existing.map(sentenceText),
    count: Math.min(opts.count ?? BATCH, allowance),
    // Once most words are solid, short restatements teach nothing new.
    stretch: isFluent(measureProgress(content.onLadder, knowledge), STRETCH_SHARE),
  });

  const rejected: Rejection[] = [];
  const assembled: Assembled[] = [];
  for (const draft of drafts) {
    const result = assembleSentence(draft, content.lexemes, allowed);
    if (result.ok) assembled.push(result.sentence);
    else rejected.push({ text: draft.english, reason: result.reason });
  }
  const fresh = await dropRepeats(
    userId,
    assembled.slice(0, allowance).map((sentence) => ({ sentence, teaches: null, word: null })),
  );
  return { candidates: fresh.candidates, rejected: [...rejected, ...fresh.rejected] };
}

/**
 * Gives a reviewed practice sentence its audio and stores it. Returns the
 * stored sentence, or why it was dropped. `makeClip` is replaceable in tests.
 */
export async function storePractice(
  userId: string,
  { sentence }: Candidate,
  makeClip = makeVerifiedClip,
): Promise<{ added: Sentence } | { rejected: Rejection }> {
  if (!(await makeClip(sentenceClip(sentence)))) {
    return { rejected: { text: sentenceText(sentence), reason: "audio did not pass the listener" } };
  }
  const row = { ...sentence, id: generatedId(userId, sentence), position: 0, note: null, generated: true, ladder: false };
  await db.insert(sentences).values({ ...row, themeId: null, ownerId: userId }).onConflictDoNothing();
  return { added: row };
}

/**
 * Writes new practice sentences for a learner in one go: draft, second
 * opinion, audio, store; anything that fails a step is dropped. The app does
 * the same thing a step at a time from its job queue
 * (src/lib/lesson/background.ts); this is for scripts.
 */
export async function topUpSentences(userId: string, opts: TopUpOptions = {}): Promise<TopUpResult> {
  const draft = await draftPractice(userId, opts);
  const review = await reviewCandidates(draft.candidates);
  const result: TopUpResult = { skipped: draft.skipped, added: [], rejected: [...draft.rejected, ...review.rejected] };
  for (const candidate of review.kept) {
    const stored = await storePractice(userId, candidate);
    if ("added" in stored) result.added.push(stored.added);
    else result.rejected.push(stored.rejected);
  }
  return result;
}
