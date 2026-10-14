/**
 * What lessons would be written for a word, at each level, without storing
 * anything. Usage: npx tsx spike/word-lessons-probe.ts <email> <word>
 */
import "../scripts/load-env.ts";
import { eq, isNull } from "drizzle-orm";
import { db } from "../src/lib/db/index.ts";
import { lexemes, users } from "../src/lib/db/schema.ts";
import { draftWord, draftWordLessons, type Level } from "../src/lib/lesson/author.ts";
import { reviewCandidates } from "../src/lib/lesson/drafts.ts";
import { sentenceText } from "../src/lib/lesson/plan.ts";
import { measureProgress } from "../src/lib/lesson/progress.ts";
import { loadCourse, loadKnowledge, loadWordUses } from "../src/lib/lesson/store.ts";
import { workingVocabulary } from "../src/lib/lesson/vocabulary.ts";
import { checkLessons, levelOf } from "../src/lib/lesson/word-lessons.ts";
import { ownedLexeme } from "../src/lib/lesson/words.ts";

async function main() {
  const [email, input] = process.argv.slice(2);
  const [user] = await db.select().from(users).where(eq(users.email, email));
  const [content, knowledge, uses] = await Promise.all([loadCourse(user.id), loadKnowledge(user.id), loadWordUses(user.id)]);
  const examples = await db.select().from(lexemes).where(isNull(lexemes.ownerId)).limit(10);
  const drafted = await draftWord(input, null, examples);
  const entry = { ...drafted, understood: undefined };
  const word = ownedLexeme(user.id, entry, "learner");
  console.log(`word: ${word.fa} ${word.translit} = ${word.gloss}`);

  const known = [...content.lexemes.values()].filter((l) => knowledge.has(`lexeme:${l.id}`));
  const patterns = new Set([...content.patterns.keys()].filter((id) => knowledge.has(`pattern:${id}`)));
  const actual = levelOf(measureProgress(content.onLadder, knowledge), [...patterns].map((id) => content.patterns.get(id)!.title));
  console.log(`learner: ${known.length} words, ${patterns.size} grammar points, level ${actual.stage}`);

  const all = new Map([...content.lexemes, [word.id, word]]);
  const levels: Level[] = [actual, ...(["beginner", "advanced"] as const).filter((s) => s !== actual.stage).map((stage) => ({ ...actual, stage }))];
  await Promise.all(levels.map(async (level) => {
    const drafted = await draftWordLessons({ word, known: workingVocabulary(known, { uses }), upcoming: [...content.lexemes.values()].filter((l) => !knowledge.has(`lexeme:${l.id}`)), patterns, level, count: 6 });
    const draft = checkLessons(user.id, word, drafted, { lexemes: all, known: new Set(known.map((l) => l.id)), patterns });
    const review = await reviewCandidates(draft.candidates);
    const lines = [`\n== ${level.stage}${level === actual ? " (actual)" : ""}`, `companions: ${drafted.companions.map((c) => `${c.fa} ${c.translit} = ${c.gloss} (${c.why})`).join("; ") || "none"}`];
    for (const c of draft.candidates) {
      const kept = review.kept.includes(c);
      lines.push(`  ${kept ? "kept    " : "REVIEWER"} ${c.word ? "[ladder] " : "         "}${sentenceText(c.sentence)}  (${c.sentence.tokens.map((t) => t.translit).join(" ")}) = ${c.sentence.english}`);
    }
    for (const r of [...draft.rejected, ...review.rejected]) lines.push(`  dropped  ${r.text}: ${r.reason}`);
    console.log(lines.join("\n"));
  }));
}
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
