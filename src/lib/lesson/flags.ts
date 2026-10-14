import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { audioUrl, isStale, wordClip } from "@/lib/audio-key";
import { db } from "@/lib/db";
import { audioClips, flags, lexemes, sentences } from "@/lib/db/schema";
import type { Subject } from "./corrections";
import type { Editor, Loaded } from "./correct";
import { sentenceClip, sentenceText } from "./plan";

/**
 * Flags: what a person has said is wrong with a word or a sentence, kept until
 * someone fixes it (src/lib/lesson/correct.ts) or decides nothing is. Together
 * with the recordings the automated listener is unsure of, they make the review
 * list.
 */

/** Whether this person may change the word or sentence, and so flag it or say it is fine. */
export function mayChange(editor: Editor, { subject, sentence, words }: Loaded): boolean {
  const owner = subject.kind === "sentence" ? sentence!.ownerId : words[0].ownerId;
  return editor.shared || owner === editor.id;
}

export async function raiseFlag(editor: Editor, subject: Subject, note: string): Promise<void> {
  await db.insert(flags).values({ kind: subject.kind, refId: subject.id, note, userId: editor.id });
}

/** Open flags on the subject that this person may close: all of them for a reviewer, else their own. */
const closable = (editor: Editor, subject: Subject) =>
  and(
    eq(flags.kind, subject.kind),
    eq(flags.refId, subject.id),
    isNull(flags.resolvedAt),
    editor.shared ? undefined : eq(flags.userId, editor.id),
  );

/** Closes the open flags on a subject. A fix closes everyone's, since the thing itself has changed. */
export async function resolveFlags(editor: Editor, subject: Subject, outcome: "fixed" | "dismissed"): Promise<void> {
  const where =
    outcome === "fixed" ? and(eq(flags.kind, subject.kind), eq(flags.refId, subject.id), isNull(flags.resolvedAt)) : closable(editor, subject);
  await db.update(flags).set({ resolvedAt: new Date(), outcome }).where(where);
}

/** The subject's recording, if the automated checks are unsure of it and no person has approved it. */
export async function doubtedClip(loaded: Loaded): Promise<string | null> {
  const hash = loaded.sentence ? sentenceClip(loaded.sentence).hash : wordClip(loaded.words[0]).hash;
  const [clip] = await db.select().from(audioClips).where(eq(audioClips.hash, hash));
  return clip && doubted(clip) ? hash : null;
}

const doubted = (clip: typeof audioClips.$inferSelect) => !clip.approvedAt && (clip.status === "flagged" || isStale(clip));

export type ReviewItem = {
  subject: Subject;
  fa: string;
  translit: string;
  english: string;
  audioUrl: string;
  /** Written for one learner, so theirs to change. */
  own: boolean;
  flags: { id: string; note: string; createdAt: string; mine: boolean }[];
  /** Set when the automated checks are unsure of the recording. */
  audio: { heard: string | null; flagged: boolean; stale: boolean; carrier: string | null } | null;
};

type LexemeRow = typeof lexemes.$inferSelect;
type SentenceRow = typeof sentences.$inferSelect;

const itemOf = (row: { kind: "lexeme"; word: LexemeRow } | { kind: "sentence"; sentence: SentenceRow }) =>
  row.kind === "lexeme"
    ? {
        subject: { kind: "lexeme" as const, id: row.word.id },
        fa: row.word.voc,
        translit: row.word.translit,
        english: row.word.gloss,
        audioUrl: audioUrl(wordClip(row.word)),
        own: row.word.ownerId !== null,
      }
    : {
        subject: { kind: "sentence" as const, id: row.sentence.id },
        fa: sentenceText(row.sentence),
        translit: row.sentence.tokens.map((t) => t.translit).join(" "),
        english: row.sentence.english,
        audioUrl: audioUrl(sentenceClip(row.sentence)),
        own: row.sentence.ownerId !== null,
      };

/**
 * What this person has to look at: their open flags (everyone's, for a
 * reviewer), newest first, then — for a reviewer — the recordings of what they
 * can see that the automated checks are unsure of.
 */
export async function reviewList(editor: Editor): Promise<ReviewItem[]> {
  const open = await db
    .select()
    .from(flags)
    .where(and(isNull(flags.resolvedAt), editor.shared ? undefined : eq(flags.userId, editor.id)))
    .orderBy(desc(flags.createdAt));
  const visibleTo = (table: typeof lexemes | typeof sentences) => or(isNull(table.ownerId), eq(table.ownerId, editor.id));

  const flaggedWords = open.filter((f) => f.kind === "lexeme").map((f) => f.refId);
  const flaggedSentences = open.filter((f) => f.kind === "sentence").map((f) => f.refId);
  const [words, sentenceRows] = await Promise.all([
    editor.shared
      ? db.select().from(lexemes).where(visibleTo(lexemes))
      : flaggedWords.length > 0
        ? db.select().from(lexemes).where(and(inArray(lexemes.id, flaggedWords), visibleTo(lexemes)))
        : [],
    editor.shared
      ? db.select().from(sentences).where(and(eq(sentences.retired, false), visibleTo(sentences)))
      : flaggedSentences.length > 0
        ? db.select().from(sentences).where(and(inArray(sentences.id, flaggedSentences), eq(sentences.retired, false), visibleTo(sentences)))
        : [],
  ]);

  const items = new Map<string, ReviewItem>();
  const key = (subject: Subject) => `${subject.kind}:${subject.id}`;
  const add = (row: Parameters<typeof itemOf>[0]): ReviewItem => {
    const item = itemOf(row);
    const k = key(item.subject);
    if (!items.has(k)) items.set(k, { ...item, flags: [], audio: null });
    return items.get(k)!;
  };
  const wordById = new Map(words.map((w) => [w.id, w]));
  const sentenceById = new Map(sentenceRows.map((s) => [s.id, s]));

  // A flag on something that has since gone (a retired sentence) has nothing left to fix, and is not shown.
  for (const flag of open) {
    const word = flag.kind === "lexeme" ? wordById.get(flag.refId) : undefined;
    const sentence = flag.kind === "sentence" ? sentenceById.get(flag.refId) : undefined;
    if (!word && !sentence) continue;
    const item = add(word ? { kind: "lexeme", word } : { kind: "sentence", sentence: sentence! });
    item.flags.push({ id: flag.id, note: flag.note, createdAt: flag.createdAt.toISOString(), mine: flag.userId === editor.id });
  }

  if (editor.shared) {
    const clips = (await db.select().from(audioClips)).filter(doubted);
    const byHash = new Map<string, Parameters<typeof itemOf>[0]>();
    // Everything loaded is shared or the reviewer's own.
    for (const word of words) byHash.set(wordClip(word).hash, { kind: "lexeme", word });
    for (const sentence of sentenceRows) byHash.set(sentenceClip(sentence).hash, { kind: "sentence", sentence });
    for (const clip of clips) {
      const row = byHash.get(clip.hash);
      if (!row) continue;
      add(row).audio = { heard: clip.heard, flagged: clip.status === "flagged", stale: isStale(clip), carrier: clip.carrier };
    }
  }
  return [...items.values()];
}

/** How many things are waiting for this person, for a link to the list. */
export async function openFlagCount(editor: Editor): Promise<number> {
  const rows = await db
    .select({ id: flags.id })
    .from(flags)
    .where(and(isNull(flags.resolvedAt), editor.shared ? undefined : eq(flags.userId, editor.id)));
  return rows.length;
}
