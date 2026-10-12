import { eq, gt, sql } from "drizzle-orm";
import { wordClip } from "@/lib/audio-key";
import { makeVerifiedClip } from "@/lib/audio-store";
import { db } from "@/lib/db";
import { lexemes, sentences } from "@/lib/db/schema";
import { normalizeForCompare } from "@/lib/normalize";
import { assembleSentence, type Assembled } from "./assemble";
import { draftExpansion, draftPatternSentences, NEW_WORD, reviewSentences } from "./author";
import { FORM_PATTERN, GRAMMAR_SPINE } from "./forms";
import { sentenceClip, sentenceText } from "./plan";
import { isFluent, measureProgress } from "./progress";
import { loadAllContent, loadKnowledge } from "./store";
import type { Lexeme } from "./types";
import { ensureTheme, ownedLexeme, validateWord } from "./words";

/** New material is written when fewer than this many unmet words and patterns are left. */
const FRONTIER = 4;
/** …and at least this share of what the learner knows is well established. */
const READY_SHARE = 0.5;
const NEW_WORDS = 5;
const PATTERN_SENTENCES = 3;
/** Ceiling on new ladder sentences stored for one learner per rolling day. */
const DAILY_CAP = 10;

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
    const [content, knowledge] = await Promise.all([loadAllContent(userId), loadKnowledge(userId)]);
    const progress = measureProgress(content, knowledge);
    if (!opts.force) {
      if (progress.remaining >= FRONTIER) return { ...result, skipped: `${progress.remaining} things still to learn` };
      if (!isFluent(progress, READY_SHARE)) return { ...result, skipped: "still consolidating what is known" };
    }

    const themeId = goingFurtherId(userId);
    const [{ today, last }] = await db
      .select({ today: sql<number>`count(*) filter (where ${gt(sentences.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))})::int`, last: sql<number>`coalesce(max(${sentences.position}), 0)::int` })
      .from(sentences)
      .where(eq(sentences.themeId, themeId));
    if (today >= DAILY_CAP) return { ...result, skipped: "daily limit reached" };

    const known = [...content.lexemes.values()].filter((l) => knowledge.has(`lexeme:${l.id}`));
    const upcoming = [...content.lexemes.values()].filter((l) => !knowledge.has(`lexeme:${l.id}`));
    const patterns = new Set([...content.patterns.keys()].filter((id) => knowledge.has(`pattern:${id}`)));
    const taken = new Set(content.sentences.map(plainText));
    let position = last;

    type Candidate = { sentence: Assembled; teaches: string; word?: Lexeme };
    const candidates: Candidate[] = [];
    const consider = (candidate: Candidate) => {
      const text = plainText(candidate.sentence);
      if (taken.has(text)) return result.rejected.push({ text: sentenceText(candidate.sentence), reason: "already exists" });
      taken.add(text);
      candidates.push(candidate);
    };

    // --- Grammar: the next spine pattern, unless one is already waiting on the ladder. ---
    const onLadder = new Set(content.sentences.filter((s) => s.ladder).flatMap((s) => s.patternIds));
    const next = GRAMMAR_SPINE.find((p) => !patterns.has(p.id));
    if (next && !onLadder.has(next.id) && content.patterns.has(next.id)) {
      const drafts = await draftPatternSentences(next, known, patterns, PATTERN_SENTENCES);
      const allowed = { lexemes: new Set(known.map((l) => l.id)), patterns: new Set([...patterns, next.id]) };
      for (const draft of drafts) {
        const built = assembleSentence(draft, content.lexemes, allowed);
        if (!built.ok) result.rejected.push({ text: draft.english, reason: built.reason });
        else if (!built.sentence.patternIds.includes(next.id)) result.rejected.push({ text: sentenceText(built.sentence), reason: "does not use the new grammar" });
        else consider({ sentence: built.sentence, teaches: next.title });
      }
    }

    // --- Vocabulary. ---
    const drafts = await draftExpansion({
      known,
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
      if (result.added.length + today >= DAILY_CAP) break;
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
