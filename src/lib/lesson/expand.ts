import { eq, sql } from "drizzle-orm";
import { wordClip } from "@/lib/audio-key";
import { makeVerifiedClip } from "@/lib/audio-store";
import { db } from "@/lib/db";
import { lexemes, sentences } from "@/lib/db/schema";
import { normalizeForCompare } from "@/lib/normalize";
import { assembleSentence, type Assembled } from "./assemble";
import { draftExpansion, draftPatternSentences, NEW_WORD, reviewSentences } from "./author";
import { FORM_PATTERN, formsFor, GRAMMAR_SPINE } from "./forms";
import { sentenceClip, sentenceText } from "./plan";
import { isReadyForMore, measureProgress } from "./progress";
import { loadCourse, loadKnowledge, loadSameWords, loadWordUses } from "./store";
import type { Lexeme } from "./types";
import { WORKING_VOCABULARY, workingVocabulary } from "./vocabulary";
import { ensureTheme, ownedLexeme, validateWord } from "./words";

/** New material is written when fewer than this many unmet words and patterns are left. */
export const FRONTIER = 4;
/**
 * …and the learner is getting no more than this many of the things they have
 * met wrong. This is the only brake: a learner who answers everything
 * correctly gets new material as fast as they use it up, and mistakes hold it
 * back until they are put right. There is no limit per day.
 */
export const MAX_SHAKY = 3;
const NEW_WORDS = 5;
const PATTERN_SENTENCES = 3;
/** Words that can take a new piece of grammar, guaranteed a place in front of the author teaching it. */
const FORM_WORDS = 30;

export type ExpandResult = {
  skipped?: string;
  added: { text: string; english: string; teaches: string }[];
  rejected: { text: string; reason: string }[];
};

const goingFurtherId = (userId: string) => `going-further-${userId}`;
const plainText = (s: Pick<Assembled, "tokens">) => normalizeForCompare(s.tokens.map((t) => t.fa).join(" "));

const running = new Set<string>();

/**
 * Gives a learner who is running out of material something new to learn: the
 * next piece of grammar from the spine if they are ready for it, and new words
 * chosen to open up new kinds of sentence. Everything joins a personal
 * "Going further" theme on the ladder, so it is introduced one item at a time
 * like curated content.
 *
 * `dryRun` drafts and checks but makes no audio and stores nothing.
 */
export async function expandFrontier(
  userId: string,
  opts: { force?: boolean; dryRun?: boolean } = {},
): Promise<ExpandResult> {
  const result: ExpandResult = { added: [], rejected: [] };
  if (running.has(userId)) return { ...result, skipped: "already running" };
  running.add(userId);
  try {
    const [content, knowledge] = await Promise.all([loadCourse(userId), loadKnowledge(userId)]);
    const progress = measureProgress(content.onLadder, knowledge);
    if (!opts.force) {
      if (progress.remaining >= FRONTIER) return { ...result, skipped: `${progress.remaining} things still to learn` };
      if (!isReadyForMore(progress, MAX_SHAKY)) return { ...result, skipped: "still consolidating what is known" };
    }

    const themeId = goingFurtherId(userId);
    const [{ last }] = await db
      .select({ last: sql<number>`coalesce(max(${sentences.position}), 0)::int` })
      .from(sentences)
      .where(eq(sentences.themeId, themeId));

    const known = [...content.lexemes.values()].filter((l) => knowledge.has(`lexeme:${l.id}`));
    const upcoming = [...content.lexemes.values()].filter((l) => !knowledge.has(`lexeme:${l.id}`));
    const patterns = new Set([...content.patterns.keys()].filter((id) => knowledge.has(`pattern:${id}`)));
    let position = last;
    // The authors write with a working part of a large vocabulary, not all of it.
    const uses = known.length > WORKING_VOCABULARY ? await loadWordUses(userId) : new Map<string, number>();
    const mostUsed = (words: Lexeme[]) => [...words].sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0));

    type Candidate = { sentence: Assembled; teaches: string; word?: Lexeme };
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
        else consider({ sentence: built.sentence, teaches: next.title });
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
      count: NEW_WORDS,
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

    // --- Second opinion, then audio, then store. ---
    const verdicts = await reviewSentences(
      candidates.map(({ sentence, word }) => ({
        persian: sentenceText(sentence),
        translit: sentence.tokens.map((t) => t.translit).join(" "),
        english: sentence.english,
        newWord: word ? `${word.fa} (${word.translit}) = ${word.gloss}` : undefined,
      })),
    );

    for (const [index, { sentence, teaches, word }] of candidates.entries()) {
      const text = sentenceText(sentence);
      if (!verdicts[index].keep) {
        result.rejected.push({ text, reason: `reviewer: ${verdicts[index].problem}` });
        continue;
      }
      if (!opts.dryRun) {
        const audioOk = (!word || (await makeVerifiedClip(wordClip(word)))) && (await makeVerifiedClip(sentenceClip(sentence)));
        if (!audioOk) {
          result.rejected.push({ text, reason: "audio did not pass the listener" });
          continue;
        }
        await ensureTheme({
          id: themeId,
          title: "Going further",
          titleFa: "قدم بعدی",
          description: "New words and grammar the app has added for you, now that you know the rest.",
          position: 1000,
          ownerId: userId,
        });
        if (word) await db.insert(lexemes).values(word).onConflictDoNothing();
        await db
          .insert(sentences)
          .values({
            ...sentence,
            id: `${themeId}-${++position}`,
            themeId,
            ownerId: userId,
            position,
            note: null,
            generated: true,
            ladder: true,
          })
          .onConflictDoNothing();
      }
      result.added.push({ text, english: sentence.english, teaches });
    }
    return result;
  } finally {
    running.delete(userId);
  }
}

async function curatedThemeTitles(): Promise<string[]> {
  const rows = await db.query.themes.findMany({ columns: { title: true, ownerId: true } });
  return rows.filter((t) => t.ownerId === null).map((t) => t.title);
}

// FORM_PATTERN is the contract between spine entries and forms; fail loudly at import if they drift.
for (const entry of GRAMMAR_SPINE) {
  if (FORM_PATTERN[entry.form] !== entry.id) throw new Error(`grammar spine: form "${entry.form}" does not produce pattern "${entry.id}"`);
}
