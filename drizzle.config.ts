import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read Next.js's .env.local, so load it here. Order matters:
// loadEnvFile won't override an already-set key, so .env.local (loaded first)
// wins over .env — matching Next.js precedence. In CI/prod the vars are already
// in the environment, so the missing files are simply ignored.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // not present — env comes from the shell / CI instead
  }
}

// Migrations run against the DIRECT (non-pooled) connection — same host without
// "-pooler". The running app uses the pooled DATABASE_URL.
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
});
