"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DueItem = {
  userItemId: string;
  itemId: string;
  persian: string;
  literary: string | null;
  gloss: string;
  transliteration: string | null;
  dueAt: string;
  repetitions: number;
};

export default function ReviewPage() {
  const [queue, setQueue] = useState<DueItem[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    fetch("/api/review/due")
      .then((r) => r.json())
      .then((data) => setQueue(data.due ?? []));
  }, []);

  async function grade(correct: boolean) {
    if (!queue || queue.length === 0 || grading) return;
    setGrading(true);
    const [current, ...rest] = queue;
    await fetch(`/api/review/${current.userItemId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correct }),
    });
    setQueue(rest);
    setRevealed(false);
    setGrading(false);
  }

  if (queue === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center justify-center p-6">
        <p className="text-sm text-gray-400">Loading…</p>
      </main>
    );
  }

  const current = queue[0];

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Review</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline">
          Dashboard
        </Link>
      </div>

      {!current ? (
        <p className="text-sm text-gray-500">
          Nothing due right now — nice work. Come back later or start a conversation.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-6 rounded-lg border border-gray-200 p-8">
          <p className="text-xs text-gray-400">{queue.length} due</p>
          <p dir="rtl" className="text-3xl">
            {current.persian}
          </p>

          {revealed ? (
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="text-lg text-gray-800">{current.gloss}</p>
              {current.transliteration && (
                <p className="text-sm text-gray-400">{current.transliteration}</p>
              )}
              {current.literary && (
                <p className="text-xs text-gray-400">literary: {current.literary}</p>
              )}
            </div>
          ) : (
            <button
              onClick={() => setRevealed(true)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm"
            >
              Reveal
            </button>
          )}

          {revealed && (
            <div className="flex gap-3">
              <button
                onClick={() => grade(false)}
                disabled={grading}
                className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-600 disabled:opacity-50"
              >
                Didn&apos;t know it
              </button>
              <button
                onClick={() => grade(true)}
                disabled={grading}
                className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                Knew it
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
