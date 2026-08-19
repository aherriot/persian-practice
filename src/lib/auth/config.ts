import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe base config. Contains NO database adapter (the Drizzle adapter +
 * Neon driver are Node-only) and no providers — so it can run in the Next.js
 * middleware (Edge runtime). The full config in `./index.ts` spreads this and
 * adds the adapter + providers for the Node runtime (API route, server
 * actions). This is the Auth.js "split config" pattern for Next.js middleware.
 */
export const authConfig = {
  providers: [],
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
  },
  session: {
    // JWT strategy is required because (a) the dev Credentials provider only
    // works with JWT sessions, and (b) middleware can then authorize from the
    // cookie without a DB round-trip. The email magic-link flow still uses the
    // adapter for verification tokens + user creation.
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // 1 day
  },
  callbacks: {
    // Runs in middleware for every matched request.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = Boolean(auth?.user);
      const protectedPrefixes = ["/dashboard", "/conversation", "/placement", "/review", "/topics"];
      const isProtected = protectedPrefixes.some((p) => nextUrl.pathname.startsWith(p));

      if (!isProtected) return true;
      return isLoggedIn;
    },
    // Persist the DB user id onto the token at sign-in so it survives in the JWT.
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    // Expose the user id on the session for server components / actions.
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
