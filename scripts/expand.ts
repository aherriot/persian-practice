/**
 * Runs the expansion author once for a learner and prints what it would teach
 * next. Without --store it is a dry run: nothing is saved and no audio made.
 *
 * Usage: npm run db:expand -- you@example.com [--store]
 */
import "./load-env.ts";

import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/index.ts";
import { users } from "../src/lib/db/schema.ts";
import { expandFrontier } from "../src/lib/lesson/expand.ts";

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((arg) => !arg.startsWith("--"));
  if (!email) throw new Error("usage: npm run db:expand -- you@example.com [--store]");
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) throw new Error(`no user ${email}`);

  const result = await expandFrontier(user.id, { force: true, dryRun: !args.includes("--store") });
  if (result.skipped) console.log(`Nothing written: ${result.skipped}.`);
  for (const a of result.added) console.log(`  kept      ${a.text}   — ${a.english}\n            teaches: ${a.teaches}`);
  for (const r of result.rejected) console.log(`  rejected  ${r.text}   — ${r.reason}`);
  console.log(`\n${result.added.length} kept, ${result.rejected.length} rejected.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
