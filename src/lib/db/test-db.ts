/**
 * A real Postgres for tests, in this process: PGlite, with the migrations in
 * drizzle/ applied, so a query is tested against the schema production has.
 *
 * `@/lib/db` hands out whatever client is already on `globalThis.db` before it
 * would connect to Neon, so `createTestDb()` must run before the first import
 * of anything that imports it — in a `before()` hook, with the module under
 * test loaded by `await import(…)` afterwards.
 *
 * The client here is drizzle's PGlite driver, not the neon-http one the app
 * uses. Queries are built identically; what differs is driver-only API such as
 * `db.batch()`, which PGlite's driver does not have.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

// Relative to the repository root, where `npm test` runs.
const MIGRATIONS = path.resolve("drizzle");

export async function createTestDb(): Promise<TestDb> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  (globalThis as unknown as { db?: TestDb }).db = db;
  return db;
}

/** Empties every table, so each test starts from nothing. */
export async function emptyTestDb(db: TestDb): Promise<void> {
  const tables = Object.values(schema)
    .filter((value) => is(value, PgTable))
    .map((table) => sql.identifier(getTableName(table as PgTable)));
  await db.execute(sql`truncate table ${sql.join(tables, sql`, `)} cascade`);
}

/** Shuts the database down; without this the test process waits on it before exiting. */
export async function closeTestDb(db: TestDb): Promise<void> {
  await db.$client.close();
}
