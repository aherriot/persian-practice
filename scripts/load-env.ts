// Side-effect-only module: loads Next's env files for scripts run outside
// `next dev`/`next build` (which load them automatically). Must be the FIRST
// import in any script that touches `src/lib/db` — esbuild/tsx hoists all
// import statements above other top-level code, so a loadEnvFile() call
// written before other imports still runs after them unless it lives in its
// own module that's imported first (import order among imports IS preserved).
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // not present — env comes from the shell / CI instead
  }
}
