/**
 * Whether the dev sign-in backdoor (the Credentials provider + the dev form on
 * the sign-in page) is enabled *at all*. It's a backdoor, so it must be OFF in
 * real production but ON everywhere a real inbox is inconvenient — local dev,
 * CI, and Vercel *preview* deploys (where the magic-link email is unreliable).
 *
 * The subtlety: Vercel builds *every* deploy — production AND preview — with
 * `NODE_ENV=production`, so `NODE_ENV` alone can't distinguish them. Vercel's
 * own `VERCEL_ENV` can: it's "production" | "preview" | "development". So when
 * we're on Vercel we trust `VERCEL_ENV`; off Vercel (local, CI) we fall back to
 * `NODE_ENV`.
 *
 * Edge-safe (only reads env vars) so it can be imported from the proxy
 * config, Node-runtime auth config, and server components alike.
 */
function isRealProduction(): boolean {
  return process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV === "production"
    : process.env.NODE_ENV === "production";
}

export const devAuthEnabled = !isRealProduction();

/** Emails permitted to use dev sign-in, from `DEV_SIGNIN_ALLOWED_EMAILS`. */
function allowedEmails(): Set<string> {
  return new Set(
    (process.env.DEV_SIGNIN_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Whether `email` may sign in through the dev credentials backdoor. This is the
 * security boundary for the whole flow — enforce it wherever a sign-in is
 * actually performed, not just in the UI.
 *
 * - If `DEV_SIGNIN_ALLOWED_EMAILS` is set, only those emails pass — everywhere.
 * - With no allowlist: local/CI allow any email, but Vercel *previews* deny
 *   all — a preview URL is shareable/guessable, so an email must be explicitly
 *   opted in there.
 */
export function isDevSignInAllowed(email: string): boolean {
  if (isRealProduction()) return false;

  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  const allowed = allowedEmails();
  if (allowed.size > 0) return allowed.has(normalized);

  return process.env.VERCEL_ENV !== "preview";
}
