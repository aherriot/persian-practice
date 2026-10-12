/**
 * Seeds the `items` table from the curated starter bank. Idempotent: matches
 * existing rows by `persian` text and skips them, so re-running after adding
 * new entries to seed-data.ts only inserts the new ones.
 *
 * Usage: npm run db:seed
 */
import "./load-env.ts";

import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/index.ts";
import { items } from "../src/lib/db/schema.ts";
import { SEED_ITEMS } from "../src/lib/db/seed-data.ts";

async function main() {
  let inserted = 0;
  let skipped = 0;

  for (const item of SEED_ITEMS) {
    const existing = await db.query.items.findFirst({
      where: eq(items.persian, item.persian),
    });
    if (existing) {
      skipped++;
      continue;
    }
    await db.insert(items).values(item);
    inserted++;
  }

  console.log(`Seeded ${inserted} items (${skipped} already present).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
