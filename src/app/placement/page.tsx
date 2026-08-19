"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Exercise = {
  sessionId?: string;
  itemId: string;
  persian: string;
  tier: number;
  exchangeCount: number;
};

type Result = { tier: number; level: string };

export default function PlacementPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    fetch("/api/placement/start", { method: "POST" }).then(async (r) => {
      const data = await r.json();
      setSessionId(data.sessionId);
      setExercise(data);
    });
  }, []);

  async function submit() {
    if (!sessionId || !exercise || submitting) return;
    setSubmitting(true);
    const res = await fetch("/api/placement/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, itemId: exercise.itemId, answer }),
    });
    const data = await res.json();
    setAnswer("");
    setSubmitting(false);

    if (data.completed) {
      setResult({ tier: data.tier, level: data.level });
      setExercise(null);
    } else {
      setExercise(data);
    }
  }

  if (result) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">You&apos;re placed at {result.level}</h1>
        <p className="text-sm text-gray-500">
          A starting vocabulary set has been seeded — you&apos;ll see it show up in review over the
          next few days as it confirms.
        </p>
        <Link href="/dashboard" className="rounded-md bg-black px-4 py-2 text-sm text-white">
          Go to dashboard
        </Link>
      </main>
    );
  }

  if (!exercise) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-gray-400">Finding your level…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Figuring out your level…</h1>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full bg-black transition-all"
            style={{ width: `${Math.min(100, (exercise.exchangeCount / 8) * 100)}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col items-center gap-6 rounded-lg border border-gray-200 p-8">
        <p className="text-sm text-gray-400">What does this mean?</p>
        <p dir="rtl" className="text-3xl">
          {exercise.persian}
        </p>
        <input
          autoFocus
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Type the English meaning…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-center text-sm"
        />
        <button
          onClick={submit}
          disabled={submitting || !answer.trim()}
          className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? "Checking…" : "Submit"}
        </button>
      </div>
    </main>
  );
}
