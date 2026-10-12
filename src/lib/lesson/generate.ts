import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { makeVerifiedClip } from "@/lib/audio-store";
import { db } from "@/lib/db";
import { sentences } from "@/lib/db/schema";
import { normalizeForCompare } from "@/lib/normalize";
import { assembleSentence, type Assembled } from "./assemble";
import { draftSentences, reviewSentences } from "./author";
import { sentenceClip, sentenceText } from "./plan";
import { isFluent, measureProgress } from "./progress";
import { loadAllContent, loadKnowledge, loadSeen } from "./store";
import type { Sentence, ThemeContent } from "./types";

/** Below this many unseen generated sentences, more are written. */
const MIN_UNSEEN = 6;
const BATCH = 8;
/** Words the batch is built around: the ones with the fewest sentences to practise them in. */
const FOCUS_WORDS = 6;
/** Hard ceiling on spending: generated sentences stored per rolling day, across everyone. */
const DAILY_CAP = 24;
/** Share of known words that must be well established before sentences get longer and denser. */
const STRETCH_SHARE = 0.6;
/** Too few words make only strange sentences. */
const MIN_WORDS = 5;

export type TopUpResult = {
  /** Why nothing was generated, if nothing was. */
  skipped?: string;
  added: Sentence[];
  rejected: { text: string; reason: string }[];
};

const plainText = (s: Pick<Sentence, "tokens">) => normalizeForCompare(s.tokens.map((t) => t.fa).join(" "));
const generatedId = (s: Assembled) =>
  `gen-${createHash("sha256").update(`${plainText(s)}${s.endPunct}`).digest("hex").slice(0, 16)}`;

/** The learner's words with the fewest usable sentences, fewest first. */
function leastCovered(content: ThemeContent, wordIds: string[], usable: Sentence[]): string[] {
  const uses = new Map(wordIds.map((id) => [id, 0]));
  for (const s of usable) for (const id of s.lexemeIds) if (uses.has(id)) uses.set(id, uses.get(id)! + 1);
  return [...uses.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

const running = new Set<string>();

/**
 * Writes new practice sentences from the words a learner already knows, if
 * they are running short of ones they have not seen. Each sentence is built
 * mechanically from the author's draft, reviewed by a second call, and given
 * verified audio before it is stored; anything that fails a step is dropped.
 *
 * Meant to run after a response has been sent. `force` skips the stock check;
 * `focus` names the words every sentence must feature.
 */
export async function topUpSentences(userId: string, opts: { force?: boolean; count?: number; focus?: string[] } = {}): Promise<TopUpResult> {
  if (running.has(userId)) return { skipped: "already running", added: [], rejected: [] };
  running.add(userId);
  try {
    const [content, knowledge, seen] = await Promise.all([loadAllContent(userId), loadKnowledge(userId), loadSeen(userId)]);
    const skip = (skipped: string): TopUpResult => ({ skipped, added: [], rejected: [] });

    // Known words, plus the learner's own words that are still waiting to be
    // introduced, so those have sentences ready the moment they are.
    const words = [...content.lexemes.values()].filter((l) => knowledge.has(`lexeme:${l.id}`) || l.ownerId === userId);
    if (words.length < MIN_WORDS) return skip("too few words known");
    const allowed = {
      lexemes: new Set(words.map((l) => l.id)),
      patterns: new Set([...content.patterns.keys()].filter((id) => knowledge.has(`pattern:${id}`))),
    };

    const usable = content.sentences.filter(
      (s) => s.lexemeIds.every((id) => allowed.lexemes.has(id)) && s.patternIds.every((id) => allowed.patterns.has(id)),
    );
    const unseen = usable.filter((s) => s.generated && !seen.has(s.id)).length;
    if (!opts.force && unseen >= MIN_UNSEEN) return skip("enough unseen sentences");

    const [{ today }] = await db
      .select({ today: sql<number>`count(*)::int` })
      .from(sentences)
      .where(and(eq(sentences.generated, true), eq(sentences.ladder, false), gt(sentences.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))));
    if (today >= DAILY_CAP) return skip("daily limit reached");

    const drafts = await draftSentences({
      words,
      patterns: allowed.patterns,
      focus: opts.focus ?? leastCovered(content, [...allowed.lexemes], usable).slice(0, FOCUS_WORDS),
      existing: usable.map(sentenceText),
      count: Math.min(opts.count ?? BATCH, DAILY_CAP - today),
      // Once most words are solid, short restatements teach nothing new.
      stretch: isFluent(measureProgress(content, knowledge), STRETCH_SHARE),
    });

    const rejected: TopUpResult["rejected"] = [];
    const taken = new Set(content.sentences.map(plainText));
    const built: Assembled[] = [];
    for (const draft of drafts) {
      const result = assembleSentence(draft, content.lexemes, allowed);
      if (!result.ok) {
        rejected.push({ text: draft.english, reason: result.reason });
        continue;
      }
      const text = plainText(result.sentence);
      if (taken.has(text)) {
        rejected.push({ text: sentenceText(result.sentence), reason: "already exists" });
        continue;
      }
      taken.add(text);
      built.push(result.sentence);
    }

    const verdicts = await reviewSentences(
      built.map((s) => ({
        persian: sentenceText(s),
        translit: s.tokens.map((t) => t.translit).join(" "),
        english: s.english,
      })),
    );

    const added: Sentence[] = [];
    for (const [index, sentence] of built.entries()) {
      if (!verdicts[index].keep) {
        rejected.push({ text: sentenceText(sentence), reason: `reviewer: ${verdicts[index].problem}` });
        continue;
      }
      if (!(await makeVerifiedClip(sentenceClip(sentence)))) {
        rejected.push({ text: sentenceText(sentence), reason: "audio did not pass the listener" });
        continue;
      }
      const row = { ...sentence, id: generatedId(sentence), position: 0, note: null, generated: true, ladder: false };
      await db.insert(sentences).values({ ...row, themeId: null }).onConflictDoNothing();
      added.push(row);
    }
    return { added, rejected };
  } finally {
    running.delete(userId);
  }
}
