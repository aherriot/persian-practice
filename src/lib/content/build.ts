import { normalizePersian } from "@/lib/normalize";
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
    };
  });

  return { sentences, lexemes, patterns };
}

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
    }
    for (const id of s.patternIds) {
      if (!content.patterns.has(id)) problems.push(`${label}: unknown pattern "${id}"`);
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
