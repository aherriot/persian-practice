import { normalizeForCompare, normalizePersian } from "@/lib/normalize";
import type { Lexeme, Pattern, Sentence, ThemeContent } from "@/lib/lesson/types";
import type { ThemeSeed } from "./types";

export function sentenceId(themeId: string, index: number): string {
  return `${themeId}-${String(index + 1).padStart(3, "0")}`;
}

/** Resolves the authoring format into the shape the lesson engine and DB use. */
export function buildTheme(seed: ThemeSeed): ThemeContent {
  const lexemes = new Map<string, Lexeme>(
    seed.lexemes.map((l) => [
      l.id,
      {
        ...l,
        lemma: l.lemma ?? null,
        literary: l.literary ?? null,
        note: l.note ?? null,
        subjectPronoun: l.subjectPronoun ?? null,
        verbPerson: l.verbPerson ?? null,
        ownerId: null,
        addedBy: null,
      },
    ]),
  );
  const patterns = new Map<string, Pattern>(seed.patterns.map((p) => [p.id, p]));

  const said = (english: string) => seed.sentences.flatMap((s, index) => (s.english === english ? [sentenceId(seed.id, index)] : []));

  const sentences: Sentence[] = seed.sentences.map((s, index) => {
    const tokens = s.tokens.map((t) => {
      const spec = typeof t === "string" ? { lex: t } : t;
      const lexeme = lexemes.get(spec.lex);
      if (!lexeme) throw new Error(`${seed.id} sentence ${index + 1}: unknown lexeme "${spec.lex}"`);
      return {
        lexemeId: lexeme.id,
        fa: spec.fa ?? lexeme.fa,
        voc: spec.voc ?? lexeme.voc,
        translit: spec.translit ?? lexeme.translit,
        ...(spec.after ? { after: spec.after } : {}),
      };
    });
    return {
      id: sentenceId(seed.id, index),
      position: index,
      english: s.english,
      note: s.note ?? null,
      tokens,
      endPunct: s.end ?? ".",
      lexemeIds: [...new Set(tokens.map((t) => t.lexemeId))],
      patternIds: s.patterns ?? [],
      generated: false,
      ladder: true,
      replyTo: (s.answers ?? []).flatMap(said),
    };
  });

  return { sentences, lexemes, patterns };
}

/**
 * The transliteration the audio listener is told to expect (audio-verify.ts):
 * lower-case Latin with â for the long a, a hyphen before a suffix or linking
 * vowel, an apostrophe for ع, and single spaces between words.
 */
const TRANSLIT = /^[a-zâ]+(?:['-][a-zâ]+)*(?: [a-zâ]+(?:['-][a-zâ]+)*)*$/;

/** Problems that would break the "one new thing at a time" promise. Empty = valid. */
export function validateTheme(seed: ThemeSeed): string[] {
  const problems: string[] = [];
  const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const id of dupes(seed.lexemes.map((l) => l.id))) problems.push(`duplicate lexeme id "${id}"`);
  for (const id of dupes(seed.patterns.map((p) => p.id))) problems.push(`duplicate pattern id "${id}"`);

  for (const l of seed.lexemes) {
    if (normalizePersian(l.voc) !== normalizePersian(l.fa)) {
      problems.push(`lexeme "${l.id}": vowelled form does not reduce to the plain form`);
    }
    if (!TRANSLIT.test(l.translit)) problems.push(`lexeme "${l.id}": transliteration "${l.translit}" is not in the course's alphabet`);
  }

  let content: ThemeContent;
  try {
    content = buildTheme(seed);
  } catch (err) {
    return [...problems, (err as Error).message];
  }

  const seen = new Set<string>();
  content.sentences.forEach((s, index) => {
    const label = `sentence ${index + 1} ("${s.english}")`;
    for (const t of s.tokens) {
      if (normalizePersian(t.voc) !== normalizePersian(t.fa)) {
        problems.push(`${label}: vowelled "${t.voc}" does not reduce to "${t.fa}"`);
      }
      if (!TRANSLIT.test(t.translit)) problems.push(`${label}: transliteration "${t.translit}" is not in the course's alphabet`);
      // The audio listener checks a clip word by word against the transliteration.
      if (t.translit.split(" ").length !== t.fa.split(" ").length) {
        problems.push(`${label}: "${t.fa}" and "${t.translit}" are not the same number of words`);
      }
    }
    for (const id of s.patternIds) {
      if (!content.patterns.has(id)) problems.push(`${label}: unknown pattern "${id}"`);
    }
    for (const english of seed.sentences[index].answers ?? []) {
      if (!seed.sentences.some((other) => other.english === english)) problems.push(`${label}: answers "${english}", which no sentence here says`);
      if (english === s.english) problems.push(`${label}: answers itself`);
    }
    const components = [...s.lexemeIds.map((id) => `lexeme:${id}`), ...s.patternIds.map((id) => `pattern:${id}`)];
    const fresh = components.filter((c) => !seen.has(c));
    if (fresh.length > 1) problems.push(`${label}: introduces ${fresh.length} new things (${fresh.join(", ")})`);
    fresh.forEach((c) => seen.add(c));
  });

  for (const id of content.lexemes.keys()) {
    if (!seen.has(`lexeme:${id}`)) problems.push(`lexeme "${id}" is never used`);
  }
  for (const id of content.patterns.keys()) {
    if (!seen.has(`pattern:${id}`)) problems.push(`pattern "${id}" is never used`);
  }
  return problems;
}

/**
 * Problems that only show when the themes are put side by side: they share
 * one set of lexeme and pattern ids, and one learner meets all of them.
 * Empty = valid.
 */
export function validateCourse(themes: ThemeSeed[]): string[] {
  const problems: string[] = [];
  const dupes = <T>(values: T[]) => [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];
  for (const id of dupes(themes.map((t) => t.id))) problems.push(`duplicate theme id "${id}"`);
  for (const position of dupes(themes.map((t) => t.position))) problems.push(`two themes at position ${position}`);

  // One id, one definition: the seed upserts by id, so the last theme written would win.
  const defined = new Map<string, { theme: string; json: string }>();
  for (const theme of themes) {
    for (const [kind, items] of [["lexeme", theme.lexemes], ["pattern", theme.patterns]] as const) {
      for (const item of items) {
        const key = `${kind} "${item.id}"`;
        const json = JSON.stringify(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
        const first = defined.get(key);
        if (!first) defined.set(key, { theme: theme.id, json });
        else if (first.json !== json) problems.push(`${key} is defined differently in ${first.theme} and ${theme.id}`);
      }
    }
  }

  // One spelling, one word: tiles and missing-word options show only the
  // spelling, so two words written alike could not be told apart.
  const spelled = new Map<string, string>();
  for (const lexeme of themes.flatMap((t) => t.lexemes)) {
    const spelling = normalizeForCompare(lexeme.fa);
    const other = spelled.get(spelling);
    if (other && other !== lexeme.id) problems.push(`lexemes "${other}" and "${lexeme.id}" are both spelled ${lexeme.fa}`);
    spelled.set(spelling, lexeme.id);
  }

  const said = new Map<string, string>();
  const meant = new Map<string, { id: string; words: string }>();
  for (const theme of themes) {
    let content: ThemeContent;
    try {
      content = buildTheme(theme);
    } catch {
      continue; // validateTheme reports it
    }
    for (const s of content.sentences) {
      // The same sentence twice is a wasted rung, and one audio clip for two rows.
      const text = normalizeForCompare(s.tokens.map((t) => t.fa).join(" ")) + s.endPunct;
      const twin = said.get(text);
      if (twin) problems.push(`${s.id} repeats ${twin}`);
      said.set(text, s.id);

      // Sentences with the same English are accepted as answers for one
      // another (variants.ts), so they must be the same words, bar a subject pronoun.
      const core = normalizeForCompare(
        s.tokens
          .filter((t) => !content.lexemes.get(t.lexemeId)?.subjectPronoun)
          .map((t) => t.fa)
          .join(" "),
      );
      const same = meant.get(s.english);
      if (same && same.words !== core) problems.push(`${s.id} and ${same.id} share the English "${s.english}" but not the Persian`);
      if (!same) meant.set(s.english, { id: s.id, words: core });
    }
  }
  return problems;
}
