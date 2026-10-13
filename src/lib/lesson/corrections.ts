import { z } from "zod";
import { TRANSLIT } from "@/lib/content/build";
import type { CorrectionChanges, SentenceToken } from "@/lib/db/schema";
import { normalizePersian } from "@/lib/normalize";
import { applyForm, FORMS } from "./forms";
import type { Lexeme, Sentence } from "./types";

/**
 * Fixing a word or a sentence from inside the app. A person says in their own
 * words what is wrong; the author turns that into a `Proposal`
 * (author.ts); the person agrees to it; it is applied and recorded
 * (correct.ts). This file is the part with no database or model in it: what a
 * proposal may say, what it does to a row, and whether the result is sound.
 */

/** What is being fixed. */
export type Subject = { kind: "lexeme" | "sentence"; id: string };

const maybe = z.string().nullable();

/**
 * A fix, as the author writes it and as the browser sends it back once agreed.
 * A null field is left as it is.
 */
export const Proposal = z.object({
  /** One or two sentences for the person: what will change, or why nothing should. */
  summary: z.string(),
  /** Changes to dictionary entries. They reach every sentence the word is in. */
  words: z.array(
    z.object({
      id: z.string(),
      fa: maybe,
      voc: maybe,
      translit: maybe,
      gloss: maybe,
      // An empty string removes these two.
      literary: maybe,
      note: maybe,
    }),
  ),
  /** Changes to the one sentence being fixed. */
  sentence: z
    .object({
      english: maybe,
      // An empty string removes the note.
      note: maybe,
      /** The whole sentence again, word by word, when its Persian changes. */
      tokens: z.array(z.object({ word: z.string(), fa: z.string(), voc: z.string(), translit: z.string(), comma: z.boolean() })).nullable(),
    })
    .nullable(),
  /** A recording that says the right text wrongly, to be made again. */
  audio: z
    .object({
      clip: z.enum(["word", "sentence"]),
      wordId: maybe,
      reason: z.enum(["word", "accent", "pause", "other"]),
    })
    .nullable(),
  /** Take a sentence the app wrote out of use, when no small change would save it. */
  retire: z.boolean(),
});
export type Proposal = z.infer<typeof Proposal>;
export type WordEdit = Proposal["words"][number];
export type SentenceEdit = NonNullable<Proposal["sentence"]>;

const stable = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
/** Equal as data, whatever order the keys are in: tokens come back from the database with theirs rearranged. */
export const same = (a: unknown, b: unknown) => stable(a ?? null) === stable(b ?? null);

const REQUIRED = ["fa", "voc", "translit", "gloss"] as const;
const REMOVABLE = ["literary", "note"] as const;

/** The entry with an edit applied, and what that changed. */
export function editWord<L extends Lexeme>(lexeme: L, edit: WordEdit): { lexeme: L; changes: CorrectionChanges } {
  const next = { ...lexeme };
  const changes: CorrectionChanges = {};
  const set = <K extends (typeof REQUIRED)[number] | (typeof REMOVABLE)[number]>(field: K, to: L[K]) => {
    if (to === lexeme[field]) return;
    changes[field] = { from: lexeme[field], to };
    next[field] = to;
  };
  for (const field of REQUIRED) {
    const value = edit[field]?.trim();
    if (value) set(field, field === "translit" ? value.toLowerCase() : value);
  }
  for (const field of REMOVABLE) {
    if (edit[field] !== null) set(field, edit[field].trim() || null);
  }
  return { lexeme: next, changes };
}

const SPELLING = ["fa", "voc", "translit"] as const;
/** Whether a change to an entry is one its sentences have to follow. */
export const respelled = (changes: CorrectionChanges) => SPELLING.some((field) => field in changes);

/**
 * A sentence's words after one of them has been respelled in the dictionary.
 * A word in one of the forms the course makes (negated, "my …", linked…) is
 * put into that form again from the new spelling. A word written some other
 * way keeps whatever was its own and takes the rest.
 */
export function respell(tokens: SentenceToken[], was: Lexeme, now: Lexeme): SentenceToken[] {
  return tokens.map((token) => {
    if (token.lexemeId !== was.id) return token;
    for (const form of FORMS) {
      const made = applyForm(was, form);
      if (!made || !SPELLING.every((field) => made[field] === token[field])) continue;
      const remade = applyForm(now, form);
      if (remade) return { ...token, ...remade };
    }
    const next = { ...token };
    for (const field of SPELLING) if (token[field] === was[field]) next[field] = now[field];
    return next;
  });
}

const lexemeIdsOf = (tokens: SentenceToken[]) => [...new Set(tokens.map((token) => token.lexemeId))];

/** A sentence with new words in it; which words it uses follows from them. */
export const withTokens = <S extends Pick<Sentence, "tokens" | "lexemeIds">>(sentence: S, tokens: SentenceToken[]): S => ({
  ...sentence,
  tokens,
  lexemeIds: lexemeIdsOf(tokens),
});

/** The sentence with an edit applied, and what that changed. */
export function editSentence<S extends Pick<Sentence, "english" | "note" | "tokens" | "lexemeIds">>(
  sentence: S,
  edit: SentenceEdit,
): { sentence: S; changes: CorrectionChanges } {
  let next = { ...sentence };
  const changes: CorrectionChanges = {};
  const english = edit.english?.trim();
  if (english && english !== sentence.english) {
    changes.english = { from: sentence.english, to: english };
    next.english = english;
  }
  if (edit.note !== null) {
    const note = edit.note.trim() || null;
    if (note !== sentence.note) {
      changes.note = { from: sentence.note, to: note };
      next.note = note;
    }
  }
  if (edit.tokens) {
    const tokens = edit.tokens.map(
      (token, index): SentenceToken => ({
        lexemeId: token.word,
        fa: token.fa.trim(),
        voc: token.voc.trim() || token.fa.trim(),
        translit: token.translit.trim().toLowerCase(),
        ...(token.comma && index < edit.tokens!.length - 1 ? { after: "،" } : {}),
      }),
    );
    if (!same(tokens, sentence.tokens)) {
      changes.tokens = { from: sentence.tokens, to: tokens };
      next = withTokens(next, tokens);
    }
  }
  return { sentence: next, changes };
}

const PERSIAN = /^[؀-ۿ‌\s]+$/;

/** What is wrong with a piece of Persian as the course writes it: its spelling, vowelled spelling and pronunciation. */
function spellingProblems(label: string, word: { fa: string; voc: string; translit: string }): string[] {
  const problems: string[] = [];
  if (!word.fa || !PERSIAN.test(word.fa)) problems.push(`${label}: the spelling must be in Persian script.`);
  if (normalizePersian(word.voc) !== normalizePersian(word.fa)) {
    problems.push(`${label}: the vowelled spelling "${word.voc}" must be the letters of "${word.fa}" with vowel marks added, nothing else.`);
  }
  if (!TRANSLIT.test(word.translit)) {
    problems.push(
      `${label}: the pronunciation "${word.translit}" must be lower-case Latin letters with â for the long a, a hyphen before a suffix, an apostrophe for ع, and single spaces.`,
    );
  } else if (word.translit.split(" ").length !== word.fa.split(" ").length) {
    // The audio listener checks a clip word by word against the pronunciation.
    problems.push(`${label}: "${word.fa}" and "${word.translit}" are not the same number of words.`);
  }
  return problems;
}

/** Problems with an entry after an edit. Empty = sound. */
export function wordProblems(lexeme: Lexeme, changes: CorrectionChanges): string[] {
  const problems = respelled(changes) ? spellingProblems(lexeme.translit, lexeme) : [];
  if (!lexeme.gloss) problems.push(`${lexeme.translit}: the meaning is missing.`);
  return problems;
}

/**
 * Problems with a sentence after an edit. Empty = sound. Its words may be
 * respelled, reordered or put in another form, and one may be dropped; a word
 * it did not have cannot be brought in, since nothing says the learner has met
 * it. A sentence that introduces a word has to keep every one of its own.
 */
export function sentenceProblems(now: Pick<Sentence, "english" | "tokens" | "lexemeIds">, was: Pick<Sentence, "lexemeIds" | "ladder">, changes: CorrectionChanges): string[] {
  const problems: string[] = [];
  if (!now.english) problems.push("The translation is missing.");
  if (!("tokens" in changes)) return problems;
  if (now.tokens.length === 0) return [...problems, "The sentence has no words left."];
  for (const token of now.tokens) problems.push(...spellingProblems(token.translit || token.fa, token));
  const brought = now.lexemeIds.filter((id) => !was.lexemeIds.includes(id));
  if (brought.length > 0) problems.push(`The sentence can only use the words it already has, not ${brought.join(", ")}.`);
  const dropped = was.lexemeIds.filter((id) => !now.lexemeIds.includes(id));
  if (was.ladder && dropped.length > 0) problems.push(`This sentence is where its words are taught, so it has to keep all of them, including ${dropped.join(", ")}.`);
  return problems;
}

// --- Seeding again ---

export type Recorded = { kind: Subject["kind"]; refId: string; changes: CorrectionChanges };

type Content<S> = { lexemes: Map<string, Lexeme>; sentences: S[] };

/**
 * Curated content as the code has it, with the fixes made in the app put back
 * on top, oldest first. A fix is only made where the content still says what
 * it said when the fix was made (or already says what the fix made it say):
 * if the code has since been edited there, the code wins and the fix is
 * returned as skipped. Fixes to things this content does not have are ignored.
 */
export function replay<S extends Pick<Sentence, "id" | "english" | "note" | "tokens" | "lexemeIds">>(
  content: Content<S>,
  recorded: Recorded[],
): Content<S> & { applied: number; skipped: Recorded[] } {
  const lexemes = new Map(content.lexemes);
  let sentences = content.sentences;
  let applied = 0;
  const skipped: Recorded[] = [];

  const patch = <T extends object>(row: T, correction: Recorded): T | null => {
    const next = { ...row } as Record<string, unknown>;
    for (const [field, { from, to }] of Object.entries(correction.changes)) {
      if (same(next[field], from)) next[field] = to;
      else if (!same(next[field], to)) return null;
    }
    return next as T;
  };

  for (const correction of recorded) {
    if (correction.kind === "lexeme") {
      const was = lexemes.get(correction.refId);
      if (!was) continue;
      const now = patch(was, correction);
      if (!now) {
        skipped.push(correction);
        continue;
      }
      lexemes.set(was.id, now);
      if (respelled(correction.changes)) {
        sentences = sentences.map((s) => (s.lexemeIds.includes(was.id) ? withTokens(s, respell(s.tokens, was, now)) : s));
      }
    } else {
      const index = sentences.findIndex((s) => s.id === correction.refId);
      if (index < 0) continue;
      const now = patch(sentences[index], correction);
      if (!now) {
        skipped.push(correction);
        continue;
      }
      sentences = sentences.with(index, "tokens" in correction.changes ? withTokens(now, now.tokens) : now);
    }
    applied++;
  }
  return { lexemes, sentences, applied, skipped };
}
