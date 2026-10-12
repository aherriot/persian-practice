/**
 * Runs the sentence author once for a learner and prints what it kept and
 * what it threw away, with reasons. The app does this by itself after a
 * session; this is for looking at the output.
 *
 * Usage: npm run db:sentences -- you@example.com [count]
 */
import "./load-env.ts";

import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/index.ts";
import { users } from "../src/lib/db/schema.ts";
import { topUpSentences } from "../src/lib/lesson/generate.ts";
import { sentenceText } from "../src/lib/lesson/plan.ts";

async function main() {
  const [email, count] = process.argv.slice(2);
  if (!email) throw new Error("usage: npm run db:sentences -- you@example.com [count]");
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) throw new Error(`no user ${email}`);

  const result = await topUpSentences(user.id, { force: true, count: count ? Number(count) : undefined });
  if (result.skipped) console.log(`Nothing generated: ${result.skipped}.`);
  for (const s of result.added) {
    console.log(`  kept      ${sentenceText(s)}   ${s.tokens.map((t) => t.translit).join(" ")}   — ${s.english}`);
  }
  for (const r of result.rejected) console.log(`  rejected  ${r.text}   — ${r.reason}`);
  console.log(`\n${result.added.length} kept, ${result.rejected.length} rejected.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
