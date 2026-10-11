import { requireUser } from "@/lib/auth/session";
import { signOut } from "@/lib/auth";
import { Button } from "@/components/Button";

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 bg-paper p-6">
      <h1 className="text-2xl font-semibold text-ink">Persian Practice</h1>
      <p className="text-sm text-ink/60">Signed in as {user.email ?? user.name ?? user.id}.</p>
      <p className="text-sm text-ink/60">Lessons are being rebuilt. Nothing to practise here yet.</p>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/sign-in" });
        }}
      >
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </main>
  );
}
