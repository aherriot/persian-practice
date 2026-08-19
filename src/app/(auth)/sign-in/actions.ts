"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { isDevSignInAllowed } from "@/lib/auth/dev-mode";

export type SignInState = { error: string } | null;

function emailFrom(formData: FormData): string {
  return String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Send a magic-link email. On success Auth.js redirects to the verify-request
 * page (that redirect throws NEXT_REDIRECT, which must propagate), so we only
 * catch real auth errors and surface them in the form.
 */
export async function sendMagicLinkAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = emailFrom(formData);
  if (!email) return { error: "Enter your email address." };

  try {
    await signIn("resend", { email, redirectTo: "/dashboard" });
    return null;
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "We couldn't send the link. Please try again." };
    }
    throw error;
  }
}

/** Dev-only credentials sign-in (provider is only registered outside prod). */
export async function devSignInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = emailFrom(formData);
  const name = String(formData.get("name") ?? "").trim();
  if (!email) return { error: "Enter an email address." };
  if (!isDevSignInAllowed(email)) {
    return { error: "This email isn't allowed to use dev sign-in here." };
  }

  try {
    await signIn("dev-credentials", { email, name, redirectTo: "/dashboard" });
    return null;
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Sign-in failed." };
    }
    throw error;
  }
}
