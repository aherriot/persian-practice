"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/Button";
import { reportError } from "@/lib/report-error";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError("page", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-6 bg-paper px-5 py-8 text-center">
      <h1 className="font-[family-name:var(--font-display-latin)] text-2xl font-bold text-ink">Something went wrong</h1>
      <p className="max-w-xs text-sm leading-relaxed text-ink/70">
        That page could not be shown. Answers you have already given are saved.
      </p>
      <Button autoFocus onClick={() => retry()}>
        Try again
      </Button>
      <Link href="/dashboard" className="text-sm text-ink/50 underline">
        Back to the start
      </Link>
      {error.digest && <p className="font-mono text-xs text-ink/35">Reference {error.digest}</p>}
    </main>
  );
}
