import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Singleton Drizzle client over Neon's HTTP driver. The HTTP driver is
// connectionless (one fetch per query), so it's serverless-safe by design and
// won't exhaust Neon connections from function reuse / dev hot-reload.
const globalForDb = globalThis as unknown as {
  db?: ReturnType<typeof drizzle<typeof schema>>;
};

// Connects only when nothing has been put there first, which is how tests run
// the same queries against an in-process Postgres (see ./test-db.ts).
export const db = globalForDb.db ?? drizzle(neon(process.env.DATABASE_URL!), { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}

export { schema };
