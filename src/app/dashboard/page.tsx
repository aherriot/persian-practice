import { eq } from "drizzle-orm";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { TopicPanel } from "./TopicPanel";
import { ConversationHistory } from "./ConversationHistory";

export default async function DashboardPage() {
  const user = await requireUser();
  const dbUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  const level = dbUser?.level ?? null;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/sign-in" });
          }}
        >
          <button type="submit" className="text-sm text-gray-500 underline">
            Sign out
          </button>
        </form>
      </div>
      <p className="text-sm text-gray-600">
        Signed in as {user.email ?? user.name ?? user.id}
        {level ? ` · level ${level}` : ""}.
      </p>

      {!level && (
        <Link
          href="/placement"
          className="rounded-md bg-black px-4 py-2 text-center text-sm font-medium text-white"
        >
          Take the placement test
        </Link>
      )}

      <Link
        href="/review"
        className="rounded-md border border-gray-300 px-4 py-2 text-center text-sm font-medium"
      >
        Review due items
      </Link>

      <ConversationHistory />

      <TopicPanel />
    </main>
  );
}
