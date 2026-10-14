import Link from "next/link";
import { ReviewerProvider } from "@/components/Reviewer";
import { canReviewAudio } from "@/lib/auth/reviewer";
import { requireUser } from "@/lib/auth/session";
import { reviewList } from "@/lib/lesson/flags";
import { ReviewList } from "./ReviewList";

/**
 * Everything waiting to be looked at: what has been flagged as wrong, and, for
 * a reviewer, the recordings the automated listener is unsure of. Each is
 * fixed in place, or marked as fine.
 */
export default async function ReviewPage() {
  const user = await requireUser();
  const reviewer = canReviewAudio(user.email);
  const items = await reviewList({ id: user.id, shared: reviewer });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 bg-paper px-5 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">Review</h1>
        <Link href="/dashboard" className="text-sm text-ink/50 underline">
          Back
        </Link>
      </header>
      <ReviewerProvider enabled={reviewer}>
        <ReviewList items={items} reviewer={reviewer} />
      </ReviewerProvider>
    </main>
  );
}
