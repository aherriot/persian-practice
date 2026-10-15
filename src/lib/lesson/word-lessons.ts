import { eq, inArray, sql } from "drizzle-orm";
import { wordClip } from "@/lib/audio-key";
import { makeVerifiedClip } from "@/lib/audio-store";
import { db } from "@/lib/db";
import { lexemes, sentences } from "@/lib/db/schema";
import { normalizeForCompare } from "@/lib/normalize";
import { assembleSentence } from "./assemble";
import { companionId, draftWordLessons, type Level, type WordLessons } from "./author";
import type { Candidate, Draft, Rejection } from "./drafts";
import { generatedToday, GLOBAL_DAILY_CAP, storePractice } from "./generate";
import { sentenceClip, sentenceText } from "./plan";
import { isFluent, measureProgress, type Progress } from "./progress";
import { dropRepeats } from "./repeats";
import { loadCourse, loadKnowledge, loadWordUses } from "./store";
import type { Lexeme } from "./types";
import { workingVocabulary } from "./vocabulary";
import { myWordsThemeId, ownedLexeme, validateWord } from "./words";

/**
 * Lessons for a word the learner added themselves. The word alone is on their
 * ladder from the moment it is saved (words.ts); this writes what comes after:
 * sentences that use it, as hard as the learner can manage, and the few words
 * it needs to be useful — "football" wants "I play" — each brought in by a
 * sentence on the ladder, one new thing at a time. The rest are practice
 * sentences, reviewed like any other. The learner's own words come first on
 * the ladder, so all of it reaches them soon.
 */

/** Sentences asked for around one added word. */
const LESSON_SENTENCES = 6;
/** Below this many words and grammar points met, a learner is a beginner. */
const BEGINNER_BELOW = 40;
/** From this many, and with most of it well established, they are advanced. */
const ADVANCED_FROM = 150;
const ADVANCED_SHARE = 0.6;

/** How far along a learner is, from what they have met and how well. */
export function levelOf(progress: Progress, grammar: string[]): Level {
  const stage =
    progress.known < BEGINNER_BELOW
      ? "beginner"
      : progress.known >= ADVANCED_FROM && isFluent(progress, ADVANCED_SHARE)
        ? "advanced"
        : "intermediate";
  return { stage, known: progress.known, grammar };
}

/**
 * Checks the author's lessons and puts them in teaching order: a sentence that
 * brings in a companion word is a ladder sentence carrying that word, the rest
 * practise. Anything that would use a word the learner cannot have met by then
 * is dropped. Pure.
 */
export function checkLessons(
  userId: string,
  word: Lexeme,
  drafted: WordLessons,
  course: { lexemes: Map<string, Lexeme>; known: Set<string>; patterns: Set<string> },
): Draft {
  const rejected: Rejection[] = [];
  const spellings = new Set([...course.lexemes.values()].map((l) => normalizeForCompare(l.fa)));
  const companions = new Map<string, Lexeme>();
  for (const [index, companion] of drafted.companions.entries()) {
    const { why, ...entry } = companion;
    void why; // Only for reading a draft (spike/word-lessons-probe.ts); not stored.
    const label = `${entry.fa} (${entry.gloss})`;
    const problems = validateWord(entry);
    if (problems.length > 0) rejected.push({ text: label, reason: problems.join(" ") });
    else if (spellings.has(normalizeForCompare(entry.fa))) rejected.push({ text: label, reason: "already in the course" });
    else {
      spellings.add(normalizeForCompare(entry.fa));
      companions.set(companionId(index + 1), ownedLexeme(userId, entry, "app"));
    }
  }

  const all = new Map([...course.lexemes, ...[...companions.values()].map((l) => [l.id, l] as const)]);
  const met = new Set([...course.known, word.id]);
  const candidates: Candidate[] = [];
  for (const draft of drafted.sentences) {
    const tokens = draft.tokens.map((t) => {
      const companion = companions.get(t.word);
      return companion ? { ...t, word: companion.id, form: "base" as const } : t;
    });
    const fresh = [...new Set(tokens.map((t) => t.word))].filter((id) => !met.has(id));
    const built = assembleSentence({ ...draft, tokens }, all, {
      lexemes: new Set([...met, ...fresh.filter((id) => [...companions.values()].some((c) => c.id === id))]),
      patterns: course.patterns,
    });
    if (!built.ok) rejected.push({ text: draft.english, reason: built.reason });
    else if (!built.sentence.lexemeIds.includes(word.id)) rejected.push({ text: sentenceText(built.sentence), reason: "does not use the word" });
    else if (fresh.length > 1) rejected.push({ text: sentenceText(built.sentence), reason: "brings in more than one new word" });
    else {
      const companion = fresh.length === 1 ? all.get(fresh[0])! : null;
      if (companion) met.add(companion.id);
      candidates.push({
        sentence: built.sentence,
        teaches: companion ? `${companion.fa} — ${companion.translit} — ${companion.gloss}` : null,
        word: companion,
      });
    }
  }
  return { candidates, rejected };
}

/** Drafts and checks the lessons for a word the learner added. Nothing is stored. `author` is replaceable in tests. */
export async function draftLessonsFor(userId: string, lexemeId: string, author = draftWordLessons): Promise<Draft> {
  const skip = (skipped: string): Draft => ({ skipped, candidates: [], rejected: [] });
  const [content, knowledge] = await Promise.all([loadCourse(userId), loadKnowledge(userId)]);
  const word = content.lexemes.get(lexemeId);
  if (!word || word.ownerId !== userId) return skip("no such word");
  if ((await generatedToday()) >= GLOBAL_DAILY_CAP) return skip("daily limit reached");

  const known = [...content.lexemes.values()].filter((l) => knowledge.has(`lexeme:${l.id}`) && l.id !== word.id);
  const upcoming = [...content.lexemes.values()].filter((l) => !knowledge.has(`lexeme:${l.id}`) && l.id !== word.id);
  const patterns = new Set([...content.patterns.keys()].filter((id) => knowledge.has(`pattern:${id}`)));
  const progress = measureProgress(content.onLadder, knowledge);
  const level = levelOf(progress, [...patterns].map((id) => content.patterns.get(id)!.title));
  const uses = await loadWordUses(userId);

  const drafted = await author({
    word,
    known: workingVocabulary(known, { uses }),
    upcoming,
    patterns,
    level,
    count: LESSON_SENTENCES,
  });
  const draft = checkLessons(userId, word, drafted, {
    lexemes: content.lexemes,
    known: new Set(known.map((l) => l.id)),
    patterns,
  });

  // Nothing the learner already has.
  const fresh = await dropRepeats(userId, draft.candidates);
  return { candidates: fresh.candidates, rejected: [...draft.rejected, ...fresh.rejected] };
}

/**
 * Stores one checked, reviewed lesson. One that brings in a word goes on the
 * learner's ladder with that word, after what is there already; one that only
 * practises is stored as a practice sentence. A sentence whose words did not
 * all survive (the reviewer turned down the one that brought a word in) is
 * dropped. `makeClip` is replaceable in tests.
 */
export async function storeLesson(
  userId: string,
  { sentence, word }: Candidate,
  makeClip = makeVerifiedClip,
): Promise<{ added: string } | { rejected: Rejection }> {
  const text = sentenceText(sentence);
  if (!word) {
    const needed = sentence.lexemeIds;
    const present = await db.select({ id: lexemes.id }).from(lexemes).where(inArray(lexemes.id, needed));
    if (present.length < needed.length) return { rejected: { text, reason: "a word it needs was not kept" } };
    const stored = await storePractice(userId, { sentence, word, teaches: null }, makeClip);
    return "added" in stored ? { added: text } : stored;
  }

  const audioOk = (await makeClip(wordClip(word))) && (await makeClip(sentenceClip(sentence)));
  if (!audioOk) return { rejected: { text, reason: "audio did not pass the listener" } };
  const themeId = myWordsThemeId(userId);
  const [{ last }] = await db
    .select({ last: sql<number>`coalesce(max(${sentences.position}), 0)::int` })
    .from(sentences)
    .where(eq(sentences.themeId, themeId));
  await db.insert(lexemes).values(word).onConflictDoNothing();
  await db
    .insert(sentences)
    .values({
      ...sentence,
      id: `${themeId}-${word.id}`,
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
