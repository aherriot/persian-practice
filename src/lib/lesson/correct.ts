import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { wordClip, type ClipSpec } from "@/lib/audio-key";
import { db } from "@/lib/db";
import { audioClips, corrections, lexemes, sentences, type CorrectionChanges } from "@/lib/db/schema";
import { normalizeForCompare } from "@/lib/normalize";
import {
  editSentence,
  editWord,
  respell,
  respelled,
  same,
  sentenceProblems,
  withTokens,
  wordProblems,
  type Proposal,
  type Subject,
} from "./corrections";
import { sentenceClip } from "./plan";
import { loadExamples, textArray, visibleLexeme } from "./store";

/**
 * The database half of fixing a word or sentence from inside the app (see
 * corrections.ts). `prepare` works out everything a proposal would do and
 * refuses what would leave the course unsound; `commit` does it and records it.
 * Nothing here makes audio: `commit` says which clips are new, and the caller
 * sees to them.
 */

type LexemeRow = typeof lexemes.$inferSelect;
type SentenceRow = typeof sentences.$inferSelect;
type Clip = Pick<typeof audioClips.$inferSelect, "status" | "heard" | "carrier">;

export type Loaded = {
  subject: Subject;
  sentence: SentenceRow | null;
  /** The word being fixed, or each word of the sentence being fixed. */
  words: LexemeRow[];
  /** For a word: a few sentences it is in. */
  uses: SentenceRow[];
  /** What is known of the stored recordings, by clip hash. */
  clips: Map<string, Clip>;
};

const USES_SHOWN = 5;

/** The word or sentence with what the author needs to judge a complaint about it. Null if this learner cannot see it. */
export async function loadSubject(userId: string, subject: Subject): Promise<Loaded | null> {
  let sentence: SentenceRow | null = null;
  let words: LexemeRow[];
  let uses: SentenceRow[] = [];
  if (subject.kind === "sentence") {
    [sentence = null] = await db
      .select()
      .from(sentences)
      .where(and(eq(sentences.id, subject.id), or(isNull(sentences.ownerId), eq(sentences.ownerId, userId))));
    if (!sentence) return null;
    const rows = await db.select().from(lexemes).where(inArray(lexemes.id, sentence.lexemeIds));
    words = sentence.lexemeIds.flatMap((id) => rows.find((row) => row.id === id) ?? []);
  } else {
    words = await db.select().from(lexemes).where(and(eq(lexemes.id, subject.id), visibleLexeme(userId)));
    if (words.length === 0) return null;
    uses = (await loadExamples(userId, { kind: "lexeme", id: subject.id }, USES_SHOWN)) as SentenceRow[];
  }
  const hashes = [...words.map((word) => wordClip(word).hash), ...(sentence ? [sentenceClip(sentence).hash] : [])];
  const clipRows = await db.select().from(audioClips).where(inArray(audioClips.hash, hashes));
  return { subject, sentence, words, uses, clips: new Map(clipRows.map((clip) => [clip.hash, clip])) };
}

const recording = (clip: Clip | undefined) =>
  !clip?.status
    ? "no recording yet"
    : [
        clip.status === "verified" ? "the automated listener accepted it" : `the automated listener was not satisfied, and heard "${clip.heard}"`,
        clip.carrier ? `the word cannot be said alone, so it is played inside the sentence "${clip.carrier}"` : null,
      ]
        .filter(Boolean)
        .join("; ");

const wordsOf = (sentence: SentenceRow) =>
  sentence.tokens.map((t) => `${t.voc}${t.after ?? ""}`).join(" ") + sentence.endPunct + `  (${sentence.tokens.map((t) => t.translit).join(" ")})`;

/** The subject written out for the author. */
export function describeSubject({ subject, sentence, words, uses, clips }: Loaded): string {
  const entry = (word: LexemeRow) =>
    [
      `id: ${word.id}`,
      `fa: ${word.fa}`,
      `voc: ${word.voc}`,
      `translit: ${word.translit}`,
      `gloss: ${word.gloss}`,
      `literary: ${word.literary ?? "(none)"}`,
      `note: ${word.note ?? "(none)"}`,
      `recording of the word alone: ${recording(clips.get(wordClip(word).hash))}`,
    ].join("\n  ");

  if (subject.kind === "lexeme") {
    return `The complaint is about this dictionary entry:
  ${entry(words[0])}

Sentences it is used in (for context only; they cannot be changed here, but they follow any change to the word's spelling or pronunciation):
${uses.map((s) => `- ${wordsOf(s)} = ${s.english}`).join("\n") || "(none)"}`;
  }

  const s = sentence!;
  return `The complaint is about this sentence${s.generated ? " (written by the app, not by hand)" : ""}:
  english: ${s.english}
  note: ${s.note ?? "(none)"}
  Persian: ${wordsOf(s)}
  recording of the sentence: ${recording(clips.get(sentenceClip(s).hash))}
  words, in order (word id | fa | voc | translit | comma after it):
${s.tokens.map((t, i) => `    ${i + 1}. ${t.lexemeId} | ${t.fa} | ${t.voc} | ${t.translit} | ${t.after ? "true" : "false"}`).join("\n")}

The dictionary entries of its words:
  ${words.map(entry).join("\n\n  ")}`;
}

// --- Working out what a proposal would do ---

/** One thing that will change, for the person to read before agreeing. */
export type Line = { what: string; from?: string; to?: string };

export type Plan = {
  words: { was: LexemeRow; now: LexemeRow; changes: CorrectionChanges }[];
  /** Every sentence to be rewritten: the one being fixed, and each one a respelled word is in. */
  sentences: { was: SentenceRow; now: SentenceRow }[];
  /** What the person changed in the sentence being fixed, apart from what follows from its words. */
  sentenceChanges: CorrectionChanges;
  retire: boolean;
  /** The recording to make again, and why. */
  audio: { clip: ClipSpec; label: string; reason: NonNullable<Proposal["audio"]>["reason"] } | null;
  lines: Line[];
};

export const isEmpty = (plan: Plan) => plan.words.length === 0 && plan.sentences.length === 0 && !plan.retire && !plan.audio;

const WORD_LABEL: Record<string, string> = {
  fa: "Spelling",
  voc: "Spelling with vowel marks",
  translit: "Pronunciation",
  gloss: "Meaning",
  literary: "Book form",
  note: "Note",
};

const shown = (value: unknown) => (value === null || value === "" ? "(none)" : String(value));
const said = (tokens: SentenceRow["tokens"]) => `${tokens.map((t) => `${t.voc}${t.after ?? ""}`).join(" ")}  (${tokens.map((t) => t.translit).join(" ")})`;

/** A sentence's words without its subject pronouns, which an answer may add or drop (variants.ts). */
const core = (sentence: Pick<SentenceRow, "tokens">, pronouns: Set<string>) =>
  normalizeForCompare(
    sentence.tokens
      .filter((t) => !pronouns.has(t.lexemeId))
      .map((t) => t.fa)
      .join(" "),
  );

/**
 * Sentences with the same English are taken as answers for one another, so
 * they must be the same Persian. Returns the first sentence a change would
 * newly put at odds with this one.
 */
async function meaningClash(was: SentenceRow, now: SentenceRow): Promise<SentenceRow | null> {
  const [others, pronounRows] = await Promise.all([
    db
      .select()
      .from(sentences)
      .where(
        and(
          inArray(sentences.english, [was.english, now.english]),
          ne(sentences.id, now.id),
          eq(sentences.retired, false),
          // A learner's own sentence is only ever set beside the curated ones and their own.
          now.ownerId ? or(isNull(sentences.ownerId), eq(sentences.ownerId, now.ownerId)) : undefined,
        ),
      ),
    db.select({ id: lexemes.id }).from(lexemes).where(isNotNull(lexemes.subjectPronoun)),
  ]);
  const pronouns = new Set(pronounRows.map((row) => row.id));
  const atOdds = (sentence: SentenceRow) => new Set(others.filter((o) => o.english === sentence.english && core(o, pronouns) !== core(sentence, pronouns)).map((o) => o.id));
  const before = atOdds(was);
  return others.find((o) => atOdds(now).has(o.id) && !before.has(o.id)) ?? null;
}

export type Editor = {
  id: string;
  /** May change what every learner shares, not only what was written for them. */
  shared: boolean;
};

/**
 * Everything a proposal would do to the subject, or why it cannot be done.
 * Makes no changes.
 */
export async function prepare(editor: Editor, loaded: Loaded, proposal: Proposal): Promise<{ ok: true; plan: Plan } | { ok: false; problems: string[] }> {
  const problems: string[] = [];
  const lines: Line[] = [];
  const may = (row: { ownerId: string | null }) => editor.shared || row.ownerId === editor.id;
  const SHARED = "is part of the course every learner shares, and only a reviewer can change it.";

  // Words first: a sentence follows its words.
  const words: Plan["words"] = [];
  for (const edit of proposal.words) {
    const was = loaded.words.find((word) => word.id === edit.id);
    if (!was) {
      problems.push(`"${edit.id}" is not a word that can be changed here.`);
      continue;
    }
    const { lexeme: now, changes } = editWord(was, edit);
    if (Object.keys(changes).length === 0) continue;
    if (!may(was)) {
      problems.push(`${was.translit} ${SHARED}`);
      continue;
    }
    problems.push(...wordProblems(now, changes));
    words.push({ was, now, changes });
    for (const [field, { from, to }] of Object.entries(changes)) {
      lines.push({ what: `${was.translit} — ${WORD_LABEL[field].toLowerCase()}`, from: shown(from), to: shown(to) });
    }
  }

  // One spelling, one word: tiles and missing-word options show only the spelling.
  const renamed = words.filter(({ changes }) => "fa" in changes);
  if (renamed.length > 0) {
    const all = await db.select({ id: lexemes.id, fa: lexemes.fa, gloss: lexemes.gloss, ownerId: lexemes.ownerId }).from(lexemes);
    for (const { was, now } of renamed) {
      const twin = all.find(
        (other) =>
          other.id !== now.id &&
          normalizeForCompare(other.fa) === normalizeForCompare(now.fa) &&
          // Two learners' own words never meet.
          (other.ownerId === null || was.ownerId === null || other.ownerId === was.ownerId),
      );
      if (twin) problems.push(`${now.fa} is already the spelling of another word ("${twin.gloss}").`);
    }
  }

  // Every sentence a respelled word is in, whoever it was written for.
  const moved = words.filter(({ changes }) => respelled(changes));
  const rewritten = new Map<string, { was: SentenceRow; now: SentenceRow }>();
  if (moved.length > 0) {
    const using = await db
      .select()
      .from(sentences)
      .where(sql`${sentences.lexemeIds} && ${textArray(moved.map(({ was }) => was.id))}`);
    for (const was of using) {
      const tokens = moved.reduce((all, word) => respell(all, word.was, word.now), was.tokens);
      if (!same(tokens, was.tokens)) rewritten.set(was.id, { was, now: withTokens(was, tokens) });
    }
    const elsewhere = [...rewritten.keys()].filter((id) => id !== loaded.sentence?.id).length;
    if (elsewhere > 0) lines.push({ what: `${elsewhere} ${elsewhere === 1 ? "sentence that uses" : "sentences that use"} the word will follow` });
  }

  // Then the sentence itself.
  let sentenceChanges: CorrectionChanges = {};
  let retire = false;
  const subject = loaded.sentence;
  if (subject && proposal.sentence) {
    const start = rewritten.get(subject.id)?.now ?? subject;
    const { sentence: now, changes } = editSentence(start, proposal.sentence);
    if (Object.keys(changes).length > 0) {
      if (!may(subject)) problems.push(`This sentence ${SHARED}`);
      else {
        sentenceChanges = changes;
        problems.push(...sentenceProblems(now, subject, changes));
        rewritten.set(subject.id, { was: subject, now });
        if ("english" in changes || "tokens" in changes) {
          const twin = await meaningClash(subject, now);
          if (twin) {
            problems.push(
              `Another sentence means "${twin.english}" and says ${twin.tokens.map((t) => t.fa).join(" ")}. Two sentences with the same English have to be the same Persian, so word the English differently.`,
            );
          }
        }
        if (changes.english) lines.push({ what: "Translation", from: shown(changes.english.from), to: shown(changes.english.to) });
        if (changes.note) lines.push({ what: "Note", from: shown(changes.note.from), to: shown(changes.note.to) });
        if (changes.tokens) lines.push({ what: "Persian", from: said(start.tokens), to: said(now.tokens) });
      }
    }
  }
  if (subject && proposal.retire) {
    if (!subject.generated) problems.push("Only a sentence the app wrote can be taken out of use; this one was written by hand.");
    else if (!may(subject)) problems.push(`This sentence ${SHARED}`);
    else {
      retire = true;
      lines.push({ what: "This sentence will not be shown again" });
    }
  }

  // A recording to make again: of the text as it will be.
  let audio: Plan["audio"] = null;
  if (proposal.audio) {
    const now = (word: LexemeRow) => words.find((w) => w.was.id === word.id)?.now ?? word;
    if (proposal.audio.clip === "sentence" && subject) {
      const sentence = rewritten.get(subject.id)?.now ?? subject;
      if (!may(subject)) problems.push(`The recording of this sentence ${SHARED}`);
      else audio = { clip: sentenceClip(sentence), label: "the sentence", reason: proposal.audio.reason };
    } else {
      const word = loaded.words.find((w) => w.id === proposal.audio!.wordId) ?? (loaded.subject.kind === "lexeme" ? loaded.words[0] : null);
      if (!word) problems.push("It is not clear which word's recording is meant.");
      else if (!may(word)) problems.push(`The recording of ${word.translit} ${SHARED}`);
      else audio = { clip: wordClip(now(word)), label: now(word).translit, reason: proposal.audio.reason };
    }
    if (audio && !retire) lines.push({ what: `The recording of ${audio.label} will be made again` });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, plan: { words, sentences: [...rewritten.values()], sentenceChanges, retire, audio: retire ? null : audio, lines } };
}

/**
 * Makes the changes and records them. Returns the clips whose text is new:
 * they are not registered or recorded yet.
 */
export async function commit(editor: Editor, loaded: Loaded, request: string, summary: string, plan: Plan): Promise<ClipSpec[]> {
  // No transactions on this driver; the order means a failure part-way leaves
  // sentences that follow their words rather than words ahead of their sentences.
  for (const { was, now } of plan.sentences) {
    await db
      .update(sentences)
      .set({ english: now.english, note: now.note, tokens: now.tokens, lexemeIds: now.lexemeIds })
      .where(eq(sentences.id, was.id));
  }
  for (const { now } of plan.words) {
    const { fa, voc, translit, gloss, literary, note } = now;
    await db.update(lexemes).set({ fa, voc, translit, gloss, literary, note }).where(eq(lexemes.id, now.id));
  }
  if (plan.retire && loaded.sentence) await db.update(sentences).set({ retired: true }).where(eq(sentences.id, loaded.sentence.id));

  const records = [
    ...plan.words.map(({ was, changes }) => ({ kind: "lexeme" as const, refId: was.id, changes })),
    ...(loaded.sentence && Object.keys(plan.sentenceChanges).length > 0
      ? [{ kind: "sentence" as const, refId: loaded.sentence.id, changes: plan.sentenceChanges }]
      : []),
  ];
  if (records.length > 0) {
    // Words before the sentence, a millisecond apart: this is the order they are replayed in.
    const at = Date.now();
    await db.insert(corrections).values(records.map((record, i) => ({ ...record, request, summary, userId: editor.id, createdAt: new Date(at + i) })));
  }

  const fresh = new Map<string, ClipSpec>();
  for (const { was, now } of plan.words) if (wordClip(now).hash !== wordClip(was).hash) fresh.set(wordClip(now).hash, wordClip(now));
  for (const { was, now } of plan.sentences) if (sentenceClip(now).hash !== sentenceClip(was).hash) fresh.set(sentenceClip(now).hash, sentenceClip(now));
  return [...fresh.values()];
}
