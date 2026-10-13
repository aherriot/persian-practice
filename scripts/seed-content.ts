/**
 * Upserts the hand-curated themes in src/lib/content into the database and
 * registers their audio clips (speech is synthesised by `npm run db:audio`, or
 * failing that on first play).
 * Idempotent; refuses to write a theme that fails validation.
 *
 * Usage: npm run db:seed
 */
import "./load-env.ts";

import { sql } from "drizzle-orm";
import { wordClip } from "../src/lib/audio-key.ts";
import { registerClips } from "../src/lib/audio-store.ts";
import { buildTheme, validateCourse, validateTheme } from "../src/lib/content/build.ts";
import { PATTERNS, THEMES } from "../src/lib/content/index.ts";
import { db } from "../src/lib/db/index.ts";
import { lexemes, patterns, sentences, themes } from "../src/lib/db/schema.ts";
import { GRAMMAR_SPINE } from "../src/lib/lesson/forms.ts";
import { sentenceClip } from "../src/lib/lesson/plan.ts";

const excluded = (column: string) => sql.raw(`excluded."${column}"`);

async function main() {
  // Themes share words and patterns by id; a clash between two of them would be written over silently.
  const clashes = validateCourse(THEMES);
  if (clashes.length > 0) throw new Error(`nothing seeded —\n  ${clashes.join("\n  ")}`);

  // Grammar the expansion author teaches later; the rows must exist before it does.
  await db
    .insert(patterns)
    .values(GRAMMAR_SPINE.map(({ id, title, summary }, index) => ({ id, title, summary, position: 100 + index })))
    .onConflictDoUpdate({
      target: patterns.id,
      set: Object.fromEntries(["title", "summary", "position"].map((c) => [c, excluded(c)])),
    });

  for (const seed of THEMES) {
    const problems = validateTheme(seed);
    if (problems.length > 0) {
      console.error(`${seed.id}: not seeded —\n  ${problems.join("\n  ")}`);
      process.exitCode = 1;
      continue;
    }
    const content = buildTheme(seed);
    const { id, title, titleFa, description, position } = seed;

    await db
      .insert(themes)
      .values({ id, title, titleFa, description, position })
      .onConflictDoUpdate({ target: themes.id, set: { title, titleFa, description, position } });

    await db
      .insert(lexemes)
      .values([...content.lexemes.values()])
      .onConflictDoUpdate({
        target: lexemes.id,
        set: Object.fromEntries(
          ["fa", "voc", "translit", "gloss", "lemma", "literary", "note", "subjectPronoun", "verbPerson"].map((c) => [c, excluded(c)]),
        ),
      });

    if (content.patterns.size > 0) {
      await db
        .insert(patterns)
        // Its place in the whole course, so a pattern two themes teach is not moved by whichever is seeded last.
        .values(seed.patterns.map((p) => ({ ...p, position: PATTERNS.findIndex((other) => other.id === p.id) })))
        .onConflictDoUpdate({
          target: patterns.id,
          set: Object.fromEntries(["title", "summary", "position"].map((c) => [c, excluded(c)])),
        });
    }

    await db
      .insert(sentences)
      .values(content.sentences.map((s) => ({ ...s, themeId: id })))
      .onConflictDoUpdate({
        target: sentences.id,
        set: Object.fromEntries(
          ["themeId", "position", "english", "note", "tokens", "endPunct", "lexemeIds", "patternIds"].map((c) => [
            c,
            excluded(c),
          ]),
        ),
      });

    await registerClips([
      ...content.sentences.map(sentenceClip),
      ...[...content.lexemes.values()].map(wordClip),
    ]);

    console.log(
      `${id}: ${content.sentences.length} sentences, ${content.lexemes.size} words, ${content.patterns.size} patterns`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
