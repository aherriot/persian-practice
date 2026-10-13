import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 0019 is hand-edited to carry existing rows over, which a migration onto an
// empty database (all the other tests) never exercises.
const MIGRATIONS = path.resolve("drizzle");
const SKILLS_MIGRATION = "0019_skills";

const statements = (tag: string) => readFileSync(path.join(MIGRATIONS, `${tag}.sql`), "utf8").split("--> statement-breakpoint");

test("splitting knowledge by skill keeps what each learner knew, once per skill", async () => {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const tags = journal.entries.map((entry) => entry.tag);
  const before = tags.slice(0, tags.indexOf(SKILLS_MIGRATION));
  assert.ok(before.length > 0);

  const pg = new PGlite();
  try {
    for (const tag of before) for (const statement of statements(tag)) await pg.exec(statement);
    await pg.exec(`
      insert into "User" ("id", "email") values ('me', 'me@example.com');
      insert into "Knowledge" ("id", "userId", "kind", "refId", "stability", "difficulty", "intervalDays", "repetitions", "lapses", "dueAt", "lastReviewedAt") values
        ('a', 'me', 'lexeme', 'sib', 6.5, 4.2, 6, 2, 1, '2026-10-20 08:00:00', '2026-10-14 08:00:00'),
        ('b', 'me', 'pattern', 'negation', 0, 0, 0, 0, 0, '2026-10-12 08:00:00', null);
    `);
    for (const statement of statements(SKILLS_MIGRATION)) await pg.exec(statement);

    const { rows } = await pg.query<{ refId: string; skill: string; repetitions: number; lapses: number; stability: number; due: string }>(
      `select "refId", "skill", "repetitions", "lapses", "stability", "dueAt"::text as due from "Knowledge" order by "refId", "skill"`,
    );
    assert.deepEqual(
      rows.map((row) => `${row.refId}/${row.skill}`),
      ["negation/listening", "negation/producing", "negation/reading", "sib/listening", "sib/producing", "sib/reading"],
    );
    for (const row of rows.filter((r) => r.refId === "sib")) {
      assert.deepEqual([row.repetitions, row.lapses, row.stability, row.due], [2, 1, 6.5, "2026-10-20 08:00:00"]);
    }
    const ids = await pg.query<{ n: number }>(`select count(distinct "id")::int as n from "Knowledge"`);
    assert.equal(ids.rows[0].n, 6);
    // A second row for the same skill is refused; a new row must say which skill it is.
    await assert.rejects(pg.exec(`insert into "Knowledge" ("id", "userId", "kind", "refId", "skill", "dueAt") values ('z', 'me', 'lexeme', 'sib', 'reading', now())`));
    await assert.rejects(pg.exec(`insert into "Knowledge" ("id", "userId", "kind", "refId", "dueAt") values ('y', 'me', 'lexeme', 'fig', now())`));
  } finally {
    await pg.close();
  }
});
