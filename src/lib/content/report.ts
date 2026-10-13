/**
 * Prints the curated themes as a reader would check them: each ladder sentence
 * with its transliteration and what it introduces, then the counts.
 * Reads no database and makes no audio.
 *
 * Usage: npx tsx src/lib/content/report.ts [themeId]
 */
import { buildTheme, validateCourse, validateTheme } from "./build.ts";
import { THEMES } from "./index.ts";

const only = process.argv[2];

for (const seed of THEMES) {
  if (only && seed.id !== only) continue;
  const content = buildTheme(seed);
  const seen = new Set<string>();
  console.log(`\n## ${seed.position}. ${seed.title} — ${seed.titleFa}`);
  for (const s of content.sentences) {
    const fresh = [...s.lexemeIds.map((id) => `lexeme:${id}`), ...s.patternIds.map((id) => `pattern:${id}`)].filter((c) => !seen.has(c));
    fresh.forEach((c) => seen.add(c));
    const text = s.tokens.map((t) => t.voc + (t.after ?? "")).join(" ") + s.endPunct;
    const translit = s.tokens.map((t) => t.translit + (t.after ? "," : "")).join(" ");
    console.log(`${s.id.slice(-3)}  ${text}  |  ${translit}  |  ${s.english}${fresh.length > 0 ? `  [+${fresh.join(", ")}]` : ""}`);
  }
  const shared = seed.lexemes.filter((l) => THEMES.some((t) => t !== seed && t.lexemes.some((o) => o.id === l.id))).length;
  console.log(
    `${seed.id}: ${content.lexemes.size} words (${shared} shared with another theme), ${content.patterns.size} patterns, ${content.sentences.length} sentences`,
  );
  for (const problem of validateTheme(seed)) console.log(`  PROBLEM: ${problem}`);
}
for (const problem of validateCourse(THEMES)) console.log(`PROBLEM: ${problem}`);
