/**
 * What a round of practice sentences costs, and how many survive review, under
 * the author settings in the environment (OPENAI_DRAFT_EFFORT,
 * OPENAI_AUTHOR_TIER). Drafts and reviews from a learner's real course and
 * stores nothing. Compare settings by running it once under each.
 *
 * Usage: npx tsx spike/author-cost-probe.ts <email> [rounds]
 */
import "../scripts/load-env.ts";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/index.ts";
import { users } from "../src/lib/db/schema.ts";
import { reviewCandidates } from "../src/lib/lesson/drafts.ts";
import { draftPractice } from "../src/lib/lesson/generate.ts";
import { sentenceText } from "../src/lib/lesson/plan.ts";

async function main() {
  const [email, rounds = "3"] = process.argv.slice(2);
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`no user ${email}`);
  let drafted = 0;
  let kept = 0;
  for (let round = 1; round <= Number(rounds); round++) {
    const started = Date.now();
    const draft = await draftPractice(user.id, { force: true });
    if (draft.skipped) throw new Error(`skipped: ${draft.skipped}`);
    const drafting = Date.now() - started;
    const review = await reviewCandidates(draft.candidates);
    drafted += draft.candidates.length + draft.rejected.length;
    kept += review.kept.length;
    console.log(
      `round ${round}: ${draft.candidates.length + draft.rejected.length} drafted, ${draft.rejected.length} failed assembly, ` +
        `${review.kept.length} kept · draft ${drafting}ms, review ${Date.now() - started - drafting}ms`,
    );
    for (const c of review.kept) console.log(`   ✓ ${sentenceText(c.sentence)} = ${c.sentence.english}`);
    for (const r of [...draft.rejected, ...review.rejected]) console.log(`   ✗ ${r.text} — ${r.reason}`);
  }
  console.log(`\n${kept}/${drafted} kept`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
