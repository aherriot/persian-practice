import Link from "next/link";
import { AddWord } from "@/components/AddWord";
import { requireUser } from "@/lib/auth/session";

/** Adding a word or phrase met outside the app, from the dashboard. */
export default async function AddWordPage() {
  await requireUser();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 bg-paper px-5 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">Add a word</h1>
        <Link href="/dashboard" className="text-sm text-ink/50 underline">
          Back
        </Link>
      </header>
      <p className="text-sm text-ink/70">
        Heard a word or phrase you want to learn? Type it in any way you can. The app works out the entry, you check it,
        and it joins your lessons: you meet it first in your next session, then in sentences written for your level.
      </p>
      <AddWord open />
    </main>
  );
}
