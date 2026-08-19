import { redirect } from "next/navigation";
import { auth } from "./index";

export interface AppUser {
  id: string;
  email: string | null;
  name: string | null;
}

/**
 * Server-side guard for protected areas. Returns the authenticated user or
 * redirects to sign-in. Middleware already blocks unauthenticated requests to
 * protected routes; this is the in-component guarantee that gives us a typed,
 * non-null user id for queries.
 */
export async function requireUser(): Promise<AppUser> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  };
}
