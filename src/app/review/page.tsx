import { count, eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isStale } from "@/lib/audio-store";
import { canReviewAudio } from "@/lib/auth/reviewer";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { audioClips, audioReviews } from "@/lib/db/schema";
import { ReviewList, type ReviewClip } from "./ReviewList";

/**
 * Every stored clip, for a person to listen to. Approving one pins it;
 * rejecting one remakes it. The clips the automated checks are least sure of
 * come first.
 */
export default async function ReviewPage() {
  const user = await requireUser();
  if (!canReviewAudio(user.email)) notFound();

  const [rows, rejections] = await Promise.all([
    db.select().from(audioClips).where(isNotNull(audioClips.status)).orderBy(audioClips.createdAt),
    db
      .select({ hash: audioReviews.hash, n: count() })
      .from(audioReviews)
      .where(eq(audioReviews.verdict, "rejected"))
      .groupBy(audioReviews.hash),
  ]);
  const rejected = new Map(rejections.map((r) => [r.hash, r.n]));

  const clips: ReviewClip[] = rows.map((clip) => ({
    hash: clip.hash,
    text: clip.text,
    expected: clip.expected,
    heard: clip.heard,
    carrier: clip.carrier,
    flagged: clip.status === "flagged",
    stale: isStale(clip),
    approved: clip.approvedAt !== null,
    rejections: rejected.get(clip.hash) ?? 0,
  }));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 bg-paper px-5 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">Review audio</h1>
        <Link href="/dashboard" className="text-sm text-ink/50 underline">
          Back
        </Link>
      </header>
      <ReviewList clips={clips} />
    </main>
  );
}
