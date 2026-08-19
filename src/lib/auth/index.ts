import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { authConfig } from "./config";
import { devAuthEnabled, isDevSignInAllowed } from "./dev-mode";

// The dev Credentials provider is a convenience for environments without a
// reliable inbox (local, CI, Vercel previews) — see ./dev-mode.
const devCredentialsEnabled = devAuthEnabled;

const resendApiKey = process.env.AUTH_RESEND_KEY;
// Resend allows sending to your own account email from this address without
// verifying a domain — handy for a first deploy. Override with a verified
// sender via EMAIL_FROM.
const emailFrom = process.env.EMAIL_FROM ?? "Persian Practice <onboarding@resend.dev>";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    // Email magic link via Resend's HTTP API. With AUTH_RESEND_KEY set, the
    // provider sends a real email. Without a key (typical local dev), we
    // override to log the link to the server console — and in production we
    // throw instead of silently pretending to send.
    Resend({
      apiKey: resendApiKey ?? "resend-key-unset",
      from: emailFrom,
      ...(resendApiKey
        ? {}
        : {
            async sendVerificationRequest({ identifier, url }) {
              if (process.env.NODE_ENV === "production") {
                throw new Error(
                  "AUTH_RESEND_KEY is not set — cannot send the sign-in email.",
                );
              }
              console.log(
                `\n🔗 Persian Practice sign-in link for ${identifier}:\n   ${url}\n`,
              );
            },
          }),
    }),
    // Dev-only: sign in with just an email (+ optional name). Upserts a real
    // User row.
    ...(devCredentialsEnabled
      ? [
          Credentials({
            id: "dev-credentials",
            name: "Dev sign-in",
            credentials: {
              email: { label: "Email", type: "email" },
              name: { label: "Name", type: "text" },
            },
            async authorize(credentials) {
              const email =
                typeof credentials?.email === "string"
                  ? credentials.email.trim().toLowerCase()
                  : "";
              // Authoritative allowlist check — the API route can be hit
              // directly, so the UI's pre-check isn't enough on its own.
              if (!isDevSignInAllowed(email)) return null;
              const name =
                typeof credentials?.name === "string" && credentials.name.trim()
                  ? credentials.name.trim()
                  : null;

              const existing = await db.query.users.findFirst({
                where: eq(users.email, email),
              });
              if (existing) {
                return {
                  id: existing.id,
                  email: existing.email,
                  name: existing.name,
                };
              }

              const [created] = await db
                .insert(users)
                .values({ email, name })
                .returning();
              return {
                id: created.id,
                email: created.email,
                name: created.name,
              };
            },
          }),
        ]
      : []),
  ],
});
